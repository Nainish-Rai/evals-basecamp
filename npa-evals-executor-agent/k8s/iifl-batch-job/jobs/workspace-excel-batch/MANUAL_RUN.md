# Manual Excel Batch Runbook

This is the quickest way to submit a fresh workspace batch for the full Excel workbook against the live `iifl-batch-job` namespace.

It uses:
- the live shared workspace folder `IIFL-artifacts`
- the workbook in MinIO
- a fresh batch id
- a fresh top-level `thread_id`
- a fresh per-item `thread_id`
- `anthropic/claude-sonnet-4-5-20250929` as the model override

## Preconditions

You should already have:
- working `kubectl`
- valid Teleport login
- the rebuilt executor running in namespace `iifl-batch-job`
- the live workspace available at `/workspace/IIFL-artifacts`

Check rollout:

```bash
kubectl rollout status deploy/agent-executor -n iifl-batch-job --timeout=180s
kubectl get pods -n iifl-batch-job -l app.kubernetes.io/name=agent-executor -o wide
```

Get the current executor pod:

```bash
EXECUTOR_POD=$(kubectl get pods -n iifl-batch-job -l app.kubernetes.io/name=agent-executor -o jsonpath='{.items[0].metadata.name}')
echo "$EXECUTOR_POD"
```

## 1. Copy the latest prompt template into the live pod

This extracts the current `PROMPT_TEMPLATE` from the checked-in ConfigMap and copies it into the executor pod.

```bash
python3 - <<'PY'
from pathlib import Path

src = Path("k8s/iifl-batch-job/jobs/workspace-excel-batch/configmap.yaml")
text = src.read_text()
start = text.index("  PROMPT_TEMPLATE: |\n") + len("  PROMPT_TEMPLATE: |\n")
end = text.index("\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: workspace-excel-batch-script")
block = text[start:end]

lines = []
for line in block.splitlines():
    if line.startswith("    "):
        lines.append(line[4:])
    else:
        lines.append(line)

Path("/tmp/workspace_excel_prompt_template.txt").write_text("\n".join(lines).rstrip() + "\n")
print("/tmp/workspace_excel_prompt_template.txt")
PY

kubectl cp /tmp/workspace_excel_prompt_template.txt \
  "iifl-batch-job/${EXECUTOR_POD}:/workspace/workspace_excel_prompt_template.txt" \
  -c agent-executor
```

## 2. Submit a fresh batch for all non-empty rows

This reads the workbook from:
- `s3://research-platform-bucket/workspace-batch-inputs/obligation-register-without-risk-20260316-sheet1-2.xlsx`

It submits every non-empty row from every sheet.

```bash
kubectl exec -n iifl-batch-job "$EXECUTOR_POD" -c agent-executor -- python3 - <<'PY'
import json
import os
import time
from pathlib import Path

import boto3
import pandas as pd
import requests


MODEL = "anthropic/claude-sonnet-4-5-20250929"
WORKBOOK_BUCKET = "research-platform-bucket"
WORKBOOK_KEY = "workspace-batch-inputs/obligation-register-without-risk-20260316-sheet1-2.xlsx"
LOCAL_XLSX = "/tmp/obligation-register.xlsx"
EXECUTOR_BASE_URL = "http://agent-executor.iifl-batch-job.svc.cluster.local:8010"
USER_ID = "workspace-excel-batch"


def clean_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return value


def safe_fragment(value):
    text = str(value or "").strip()
    text = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in text)
    text = text.strip("-")
    return text or "row"


s3 = boto3.client(
    "s3",
    endpoint_url="http://minio.onfinance-data.svc.cluster.local:9000",
    aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
    aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
    region_name=os.environ.get("AWS_REGION", "ap-south-1"),
)
s3.download_file(WORKBOOK_BUCKET, WORKBOOK_KEY, LOCAL_XLSX)

prompt_template = Path("/workspace/workspace_excel_prompt_template.txt").read_text()
sheets = pd.read_excel(LOCAL_XLSX, sheet_name=None)

batch_id = f"workspace-full-sonnet-{int(time.time())}"
top_thread_id = f"{batch_id}-root"
items = []

for sheet_name, df in sheets.items():
    for idx, record in enumerate(df.to_dict(orient="records")):
        cleaned = {str(k): clean_value(v) for k, v in record.items()}
        non_empty = {k: v for k, v in cleaned.items() if v not in (None, "", [])}
        if not non_empty:
            continue

        excel_row_number = idx + 2
        row_id = cleaned.get("Sr. No.")
        if row_id in (None, ""):
            row_id = excel_row_number

        item_id = f"{safe_fragment(sheet_name[:24])}-row-{excel_row_number}-{safe_fragment(row_id)}"
        question = prompt_template.format(
            sheet_name=sheet_name,
            excel_row_number=excel_row_number,
            row_id=row_id,
            row_json=json.dumps(cleaned, ensure_ascii=False, default=str),
            task_json=json.dumps(cleaned, ensure_ascii=False, indent=2, default=str),
        ).strip()

        items.append(
            {
                "item_id": item_id,
                "question": question,
            }
        )

payload = {
    "batch_id": batch_id,
    "thread_id": top_thread_id,
    "user_id": USER_ID,
    "model": MODEL,
    "items": items,
    "selected_files": [
        {
            "file_id": "workspace-iifl-artifacts",
            "file_name": "IIFL-artifacts",
            "file_url": "",
            "file_type": "workspace_folder",
            "relative_path": "IIFL-artifacts",
            "workspace_staged_path": "IIFL-artifacts",
            "preprocessing_skipped": True,
            "source_type": "workspace_staged",
        }
    ],
    "max_concurrency": 15,
}

response = requests.post(f"{EXECUTOR_BASE_URL}/batches", json=payload, timeout=180)
print("status_code=", response.status_code)
print(response.text[:4000])
PY
```

Expected success shape:

```json
{
  "batch_id": "workspace-full-sonnet-<timestamp>",
  "status": "accepted",
  "thread_id": "workspace-full-sonnet-<timestamp>-root",
  "item_count": <row_count>
}
```

## 3. Poll the batch

Replace `BATCH_ID` with the accepted value from step 2.

```bash
BATCH_ID="workspace-full-sonnet-REPLACE_ME"

kubectl exec -n iifl-batch-job "$EXECUTOR_POD" -c agent-executor -- python3 - <<PY
import json
import requests

batch_id = "${BATCH_ID}"
data = requests.get(
    f"http://agent-executor.iifl-batch-job.svc.cluster.local:8010/batches/{batch_id}",
    timeout=30,
).json()
print(json.dumps(data, indent=2)[:12000])
PY
```

Quick loop:

```bash
while true; do
  kubectl exec -n iifl-batch-job "$EXECUTOR_POD" -c agent-executor -- python3 - <<PY
import json
import requests

batch_id = "${BATCH_ID}"
data = requests.get(
    f"http://agent-executor.iifl-batch-job.svc.cluster.local:8010/batches/{batch_id}",
    timeout=30,
).json()
print(json.dumps({
    "batch_id": data.get("batch_id"),
    "status": data.get("status"),
    "items": [
        {"item_id": i.get("item_id"), "status": i.get("status")}
        for i in data.get("items", [])[:10]
    ],
}, indent=2))
PY
  sleep 10
done
```

Terminal statuses:
- `completed`
- `completed_with_errors`
- `failed`

## 4. Pull artifact URLs from MinIO trace objects

```bash
kubectl exec -n iifl-batch-job "$EXECUTOR_POD" -c agent-executor -- python3 - <<PY
import json
import os
import boto3

batch_id = "${BATCH_ID}"
s3 = boto3.client(
    "s3",
    endpoint_url="http://minio.onfinance-data.svc.cluster.local:9000",
    aws_access_key_id=os.environ["MINIO_ACCESS_KEY"],
    aws_secret_access_key=os.environ["MINIO_SECRET_KEY"],
    region_name=os.environ.get("AWS_REGION", "ap-south-1"),
)

resp = s3.list_objects_v2(
    Bucket="workspace-agent-traces-private",
    Prefix=f"workspace-agent-traces/batches/{batch_id}/items/",
)

out = []
for obj in sorted(resp.get("Contents", []), key=lambda x: x["Key"]):
    key = obj["Key"]
    if not key.endswith(".json"):
        continue
    item = json.loads(s3.get_object(Bucket="workspace-agent-traces-private", Key=key)["Body"].read())
    out.append({
        "item_id": item.get("item_id"),
        "artifact_urls": [a.get("url") for a in (item.get("artifacts") or []) if a.get("url")],
    })

print(json.dumps(out, indent=2))
PY
```

## Common errors

### 422 missing `thread_id`

The rebuilt executor requires:
- top-level `thread_id`

That is already included in the runbook payload above.

### 422 missing `user_id`

The rebuilt executor also requires top-level:
- `user_id`

This is already included above as:
- `workspace-excel-batch`

### `404` on public MinIO links

The artifacts may exist in MinIO even if `https://minio.onfinance.ai/...` returns `404` in your browser.

Use the trace-store extraction command above to confirm the artifact URLs first.

## Switching models

Use Sonnet 4.5:

```python
MODEL = "anthropic/claude-sonnet-4-5-20250929"
```

Use Opus 4.5:

```python
MODEL = "anthropic/claude-sonnet-4-5-20250929"
```

## Notes

- This flow uses the live workspace folder directly, not historical `custom_file` DB imports.
- The selected workspace is the whole `IIFL-artifacts` folder.
- The prompt is taken from the checked-in ConfigMap, so if you change prompt rules locally, recopy the template before the next run.

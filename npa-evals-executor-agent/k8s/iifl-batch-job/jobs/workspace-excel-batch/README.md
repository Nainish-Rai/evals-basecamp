# Workspace Excel Batch Job

This overlay creates a one-off Kubernetes `Job` in `iifl-batch-job` that:

- reads rows from an Excel workbook
- submits them to the internal `agent-executor` `/batches` API
- asks the workspace agent to process up to `15` items concurrently
- waits for completion
- writes an output workbook with per-row answers and status columns

Checked-in collaboration assets:

- Source workbook: [obligation-register-without-risk-20260316-sheet1-2.xlsx](/Users/paarthanimalkar/Desktop/research-platfrom/ICICI_SAAS/k8s/iifl-batch-job/jobs/workspace-excel-batch/input/obligation-register-without-risk-20260316-sheet1-2.xlsx)
- Cluster input object: `s3://research-platform-bucket/workspace-batch-inputs/obligation-register-without-risk-20260316-sheet1-2.xlsx`

Apply it with:

```sh
kubectl apply -k k8s/iifl-batch-job/jobs/workspace-excel-batch
```

Required configuration:

- Set one input source in [configmap.yaml](/Users/paarthanimalkar/Desktop/research-platfrom/ICICI_SAAS/k8s/iifl-batch-job/jobs/workspace-excel-batch/configmap.yaml):
  - `INPUT_XLSX_PATH`
  - `INPUT_XLSX_URL`
  - `INPUT_XLSX_S3_URI`
- Point `SELECTED_FILE_WORKSPACE_STAGED_PATH` at the shared workspace file the agent should use as context.

Notes:

- The checked-in Excel file is for collaboration and review in git.
- The Kubernetes job currently reads the workbook from the configured `INPUT_XLSX_S3_URI`, not from the repo checkout on your laptop.

Useful knobs:

- `BATCH_MAX_CONCURRENCY`: defaults to `15`
- `SELECTED_FILE_RELATIVE_PATH`: controls where the staged file appears inside each run workspace
- `QUESTION_COLUMN`: if present, each row uses that column as the prompt
- `PROMPT_TEMPLATE`: fallback template when `QUESTION_COLUMN` is empty or absent
- `INPUT_XLSX_SHEET_NAME`: process only one sheet; leave empty to process all sheets
- `OUTPUT_S3_URI`: optional upload target for the result workbook

Inspect progress with:

```sh
kubectl logs -f job/workspace-excel-batch -n iifl-batch-job
kubectl get job,pod -n iifl-batch-job
```

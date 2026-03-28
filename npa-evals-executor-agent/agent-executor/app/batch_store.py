from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from .minio_client import ensure_bucket, upload_private_object
from .schemas import BatchItemResult, BatchStatusCounts, BatchStatusResponse


NONTERMINAL_BATCH_STATUSES = {"accepted", "in_progress"}
NONTERMINAL_ITEM_STATUSES = {"pending", "in_progress"}


def batch_root(trace_root: Path, batch_id: str) -> Path:
    return trace_root / "batches" / batch_id


def batch_summary_path(trace_root: Path, batch_id: str) -> Path:
    return batch_root(trace_root, batch_id) / "summary.json"


def batch_item_path(trace_root: Path, batch_id: str, item_id: str) -> Path:
    return batch_root(trace_root, batch_id) / "items" / f"{item_id}.json"


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def _upload_batch_file(trace_bucket: str | None, batch_id: str, path: Path, relative_path: str) -> str | None:
    if not trace_bucket:
        return None
    ensure_bucket(trace_bucket)
    object_key = f"workspace-agent-traces/batches/{batch_id}/{relative_path}"
    return upload_private_object(path, trace_bucket, object_key)


def compute_counts(items: list[BatchItemResult]) -> BatchStatusCounts:
    counts = BatchStatusCounts(total=len(items))
    for item in items:
        if item.status == "pending":
            counts.pending += 1
        elif item.status == "in_progress":
            counts.in_progress += 1
        elif item.status == "completed":
            counts.completed += 1
        elif item.status == "failed":
            counts.failed += 1
    return counts


def write_batch_status(trace_root: Path, response: BatchStatusResponse, trace_bucket: str | None = None) -> None:
    response.counts = compute_counts(response.items)
    summary_path = batch_summary_path(trace_root, response.batch_id)
    _write_json(summary_path, response.model_dump())
    summary_url = _upload_batch_file(trace_bucket, response.batch_id, summary_path, "summary.json")
    if summary_url:
        response.summary_url = summary_url
        _write_json(summary_path, response.model_dump())
        _upload_batch_file(trace_bucket, response.batch_id, summary_path, "summary.json")
    for item in response.items:
        write_batch_item(trace_root, response.batch_id, item, trace_bucket=trace_bucket)


def write_batch_item(trace_root: Path, batch_id: str, item: BatchItemResult, trace_bucket: str | None = None) -> None:
    item_path = batch_item_path(trace_root, batch_id, item.item_id)
    _write_json(item_path, item.model_dump())
    _upload_batch_file(trace_bucket, batch_id, item_path, f"items/{item.item_id}.json")


def load_batch_status(trace_root: Path, batch_id: str) -> BatchStatusResponse | None:
    path = batch_summary_path(trace_root, batch_id)
    if not path.exists():
        return None
    return BatchStatusResponse.model_validate_json(path.read_text(encoding="utf-8"))


def load_batch_item(trace_root: Path, batch_id: str, item_id: str) -> BatchItemResult | None:
    path = batch_item_path(trace_root, batch_id, item_id)
    if path.exists():
        return BatchItemResult.model_validate_json(path.read_text(encoding="utf-8"))

    status = load_batch_status(trace_root, batch_id)
    if status is None:
        return None
    for item in status.items:
        if item.item_id == item_id:
            return item
    return None


def batch_exists(trace_root: Path, batch_id: str) -> bool:
    return batch_summary_path(trace_root, batch_id).exists()


def recover_interrupted_batches(trace_root: Path, trace_bucket: str | None = None) -> list[str]:
    batches_dir = trace_root / "batches"
    if not batches_dir.exists():
        return []

    recovered: list[str] = []
    finished_at = datetime.utcnow().isoformat()
    for summary_path in batches_dir.glob("*/summary.json"):
        response = BatchStatusResponse.model_validate_json(summary_path.read_text(encoding="utf-8"))
        if response.status not in NONTERMINAL_BATCH_STATUSES:
            continue

        response.status = "failed"
        response.completed_at = finished_at
        response.error = "executor_restarted"
        for item in response.items:
            if item.status in NONTERMINAL_ITEM_STATUSES:
                item.status = "failed"
                item.error = "executor_restarted"
                item.completed_at = finished_at
        write_batch_status(trace_root, response, trace_bucket=trace_bucket)
        recovered.append(response.batch_id)

    return recovered

from __future__ import annotations

import json
from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any

from .minio_client import ensure_bucket, upload_private_object
from .schemas import ArtifactMetadata, RunCreateRequest


logger = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def trace_run_dir(trace_root: Path, thread_id: str, run_id: str) -> Path:
    return trace_root / thread_id / run_id


def extract_usage_totals(events: list[dict[str, Any]]) -> dict[str, int]:
    totals = {
        "requests": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }
    for event in events:
        if event.get("type") != "step.response":
            continue
        usage = event.get("usage") or {}
        totals["requests"] += 1
        totals["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
        totals["completion_tokens"] += int(usage.get("completion_tokens") or 0)
        totals["total_tokens"] += int(usage.get("total_tokens") or 0)
    return totals


def write_run_trace(
    trace_root: Path,
    trace_bucket: str | None,
    request: RunCreateRequest,
    settings: dict[str, Any],
    execution_trace: list[dict[str, Any]],
    uploaded: list[ArtifactMetadata],
    answer_text: str,
    log_path: str,
    status: str,
    started_at: str,
    finished_at: str,
    error: str | None = None,
) -> tuple[Path, dict[str, str]]:
    run_dir = trace_run_dir(trace_root, request.thread_id, request.run_id)
    summary = {
        "thread_id": request.thread_id,
        "run_id": request.run_id,
        "user_id": request.user_id,
        "question": request.question,
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": max(
            0.0,
            (
                datetime.fromisoformat(finished_at) - datetime.fromisoformat(started_at)
            ).total_seconds(),
        ),
        "model": request.model or settings.get("model_name"),
        "openai_base_url": settings.get("openai_base_url"),
        "request_timeout": settings.get("request_timeout"),
        "max_steps": settings.get("max_steps"),
        "selected_files": [item.model_dump() for item in request.selected_files],
        "prior_artifacts": [item.model_dump() for item in request.prior_artifacts],
        "usage": extract_usage_totals(execution_trace),
        "artifacts": [artifact.model_dump() for artifact in uploaded],
        "final_answer_preview": answer_text[:2000],
        "log_path": log_path,
        "error": error,
        "event_count": len(execution_trace),
        "written_at": _utc_now(),
        "trace_urls": {},
    }

    summary_path = run_dir / "summary.json"
    events_path = run_dir / "events.json"
    final_answer_path = run_dir / "final_answer.md"
    _safe_json_dump(summary_path, summary)
    _safe_json_dump(events_path, execution_trace)
    final_answer_path.write_text(answer_text, encoding="utf-8")
    if error:
        (run_dir / "error.txt").write_text(error, encoding="utf-8")

    uploaded_trace_urls: dict[str, str] = {}
    if trace_bucket:
        try:
            ensure_bucket(trace_bucket)
            for path in (events_path, final_answer_path, run_dir / "error.txt"):
                if not path.exists():
                    continue
                object_key = f"workspace-agent-traces/{request.thread_id}/{request.run_id}/{path.relative_to(run_dir).as_posix()}"
                uploaded_trace_urls[str(path.relative_to(run_dir))] = upload_private_object(path, trace_bucket, object_key)
            summary["trace_urls"] = uploaded_trace_urls
            _safe_json_dump(summary_path, summary)
            object_key = f"workspace-agent-traces/{request.thread_id}/{request.run_id}/summary.json"
            uploaded_trace_urls["summary.json"] = upload_private_object(summary_path, trace_bucket, object_key)
        except Exception:
            logger.exception(
                "trace upload failed thread_id=%s run_id=%s trace_bucket=%s",
                request.thread_id,
                request.run_id,
                trace_bucket,
            )

    return run_dir, uploaded_trace_urls

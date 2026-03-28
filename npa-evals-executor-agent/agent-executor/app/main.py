from __future__ import annotations

import asyncio
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, StreamingResponse

from .batch_store import batch_exists, load_batch_item, load_batch_status, recover_interrupted_batches, write_batch_status
from .config import Settings, get_settings
from .event_stream import format_sse
from .evals_bridge import run_eval_request
from .logging_utils import configure_logging, get_logger
from .minio_client import build_object_url
from .run_agent import execute_run
from .schemas import (
    ApiIndexResponse,
    ArtifactMetadata,
    BatchCreateRequest,
    BatchCreateResponse,
    BatchItemRequest,
    BatchItemResult,
    BatchStatusResponse,
    DeleteRunResponse,
    EvalRunRequest,
    EvalRunResponse,
    HealthResponse,
    RunArtifactsResponse,
    RunCreateRequest,
    RunCreateResponse,
    RunLogsResponse,
    RunStatusResponse,
    UploadFileResult,
    UploadFilesResponse,
)
from .workspace_manager import WorkspaceManager


@dataclass
class RunState:
    request: RunCreateRequest
    events: list[tuple[str, dict]] = field(default_factory=list)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    completed: bool = False
    status: str = "accepted"
    artifacts: list[ArtifactMetadata] = field(default_factory=list)
    final_answer: str = ""
    error: str | None = None
    log_path: str | None = None
    accepted_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None

    async def add_event(self, event_type: str, payload: dict) -> None:
        async with self.condition:
            self.events.append((event_type, payload))
            self.condition.notify_all()

    async def mark_completed(self, status: str) -> None:
        async with self.condition:
            self.status = status
            self.completed = True
            self.condition.notify_all()


@dataclass
class BatchState:
    request: BatchCreateRequest
    response: BatchStatusResponse
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


settings: Settings = get_settings()
configure_logging()
logger = get_logger("agent_executor.api")
workspace_manager = WorkspaceManager(settings.workspace_root)
run_registry: dict[str, RunState] = {}
batch_registry: dict[str, BatchState] = {}
loop: asyncio.AbstractEventLoop | None = None

SERVICE_NAME = "workspace-agent-executor"
API_VERSION = "v1"
PUBLIC_OPENAPI_PATHS = {
    "/api/v1",
    "/api/v1/healthz",
    "/api/v1/readyz",
}

app = FastAPI(
    title="Workspace Agent Executor API",
    version=API_VERSION,
    description=(
        "External API for uploading source files, running the workspace agent, "
        "tracking batches, and driving eval runs."
    ),
    openapi_tags=[
        {"name": "System", "description": "Service discovery and health endpoints."},
        {"name": "Files", "description": "Upload files to stage them into a thread workspace."},
        {"name": "Runs", "description": "Single-run execution endpoints."},
        {"name": "Batches", "description": "Multi-item execution endpoints."},
        {"name": "Evals", "description": "Trace-first eval harness endpoint."},
    ],
)

if settings.cors_allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allowed_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
INTERESTING_BATCH_EVENTS = {
    "workspace.created",
    "file.downloaded",
    "file.reused",
    "profile.ready",
    "artifact.reused",
    "artifact.created",
    "agent.step",
    "agent.tool_call",
    "agent.tool_result",
    "agent.summary",
}


class BatchItemExecutionError(Exception):
    def __init__(self, message: str, activity_summary: list[dict], log_path: str, trace_summary_url: str | None = None) -> None:
        super().__init__(message)
        self.activity_summary = activity_summary
        self.log_path = log_path
        self.trace_summary_url = trace_summary_url


def _now() -> str:
    return datetime.utcnow().isoformat()


def _join_url(request: Request, path: str) -> str:
    base = settings.public_base_url.rstrip("/") if settings.public_base_url else str(request.base_url).rstrip("/")
    return f"{base}{path}"


def _is_public_path(path: str) -> bool:
    return path in {
        "/",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
        "/openapi.json",
        "/healthz",
        "/readyz",
        *PUBLIC_OPENAPI_PATHS,
    }


def _extract_api_key(request: Request) -> str | None:
    direct = request.headers.get("x-api-key", "").strip()
    if direct:
        return direct
    auth_header = request.headers.get("authorization", "").strip()
    if not auth_header.lower().startswith("bearer "):
        return None
    return auth_header[7:].strip() or None


def _is_api_key_valid(candidate: str | None) -> bool:
    if not settings.api_keys:
        return True
    if not candidate:
        return False
    return any(secrets.compare_digest(candidate, expected) for expected in settings.api_keys)


def _build_run_paths(run_id: str) -> dict[str, str]:
    return {
        "stream_path": f"/api/v1/runs/{run_id}/stream",
        "status_path": f"/api/v1/runs/{run_id}",
        "artifacts_path": f"/api/v1/runs/{run_id}/artifacts",
        "logs_path": f"/api/v1/runs/{run_id}/logs",
        "delete_path": f"/api/v1/runs/{run_id}",
    }


def _build_batch_status_path(batch_id: str) -> str:
    return f"/api/v1/batches/{batch_id}"


def _build_run_status_response(state: RunState) -> RunStatusResponse:
    paths = _build_run_paths(state.request.run_id)
    return RunStatusResponse(
        run_id=state.request.run_id,
        thread_id=state.request.thread_id,
        user_id=state.request.user_id,
        status=state.status,
        stream_path=paths["stream_path"],
        final_answer=state.final_answer or None,
        artifacts=state.artifacts,
        error=state.error,
        log_path=state.log_path,
        accepted_at=state.accepted_at,
        started_at=state.started_at,
        completed_at=state.completed_at,
    )


def _sanitize_upload_name(filename: str | None) -> str:
    if not filename:
        return "upload.bin"
    name = Path(filename).name.strip()
    return name or "upload.bin"


def _normalize_relative_path(value: str, field_name: str) -> str:
    candidate = Path(value.strip())
    if candidate.is_absolute():
        raise HTTPException(status_code=400, detail=f"{field_name} must be relative")
    if any(part == ".." for part in candidate.parts):
        raise HTTPException(status_code=400, detail=f"{field_name} must not contain '..'")
    parts = [part for part in candidate.parts if part not in {"", "."}]
    if not parts:
        raise HTTPException(status_code=400, detail=f"{field_name} must be non-empty")
    return Path(*parts).as_posix()


def _normalize_identifier(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail=f"{field_name} must be non-empty")
    if normalized != Path(normalized).name:
        raise HTTPException(status_code=400, detail=f"{field_name} must not contain path separators")
    if any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._" for character in normalized):
        raise HTTPException(status_code=400, detail=f"{field_name} contains unsupported characters")
    return normalized


def _validate_run_request(request: RunCreateRequest) -> None:
    _normalize_identifier(request.run_id, "run_id")
    _normalize_identifier(request.thread_id, "thread_id")
    for selected_file in request.selected_files:
        relative_input = selected_file.relative_path or selected_file.file_name
        _normalize_relative_path(relative_input, "selected_files.relative_path")
        if selected_file.workspace_staged_path:
            _normalize_relative_path(selected_file.workspace_staged_path, "selected_files.workspace_staged_path")
    for artifact in request.prior_artifacts:
        relative_artifact = artifact.workspace_path or artifact.name
        _normalize_relative_path(relative_artifact, "prior_artifacts.workspace_path")


def _validate_batch_request(request: BatchCreateRequest) -> None:
    _normalize_identifier(request.batch_id, "batch_id")
    _normalize_identifier(request.thread_id, "thread_id")
    for item in request.items:
        _normalize_identifier(item.item_id, "items.item_id")
    for selected_file in request.selected_files:
        relative_input = selected_file.relative_path or selected_file.file_name
        _normalize_relative_path(relative_input, "selected_files.relative_path")
        if selected_file.workspace_staged_path:
            _normalize_relative_path(selected_file.workspace_staged_path, "selected_files.workspace_staged_path")


def _custom_openapi() -> dict:
    if app.openapi_schema is not None:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["ApiKeyAuth"] = {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
    }
    for path, operations in schema.get("paths", {}).items():
        if path in PUBLIC_OPENAPI_PATHS:
            continue
        for operation in operations.values():
            operation.setdefault("security", [{"ApiKeyAuth": []}])
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if _is_public_path(request.url.path):
        return await call_next(request)
    if _is_api_key_valid(_extract_api_key(request)):
        return await call_next(request)
    return JSONResponse(
        status_code=401,
        content={"detail": "missing or invalid API key"},
    )


async def _emit(state: RunState, event_type: str, payload: dict) -> None:
    payload.setdefault("run_id", state.request.run_id)
    payload.setdefault("timestamp", _now())
    await state.add_event(event_type, payload)


async def _run_background(state: RunState) -> None:
    try:
        logger.info("background run started run_id=%s thread_id=%s user_id=%s", state.request.run_id, state.request.thread_id, state.request.user_id)
        state.status = "in_progress"
        state.started_at = _now()
        await _emit(state, "run.started", {"thread_id": state.request.thread_id})

        def emit_from_worker(event_type: str, payload: dict) -> None:
            if loop is None:
                return
            asyncio.run_coroutine_threadsafe(_emit(state, event_type, payload), loop)

        answer, artifacts, _trace, log_path, _trace_summary_url = await asyncio.to_thread(
            execute_run,
            state.request,
            settings,
            workspace_manager,
            emit_from_worker,
        )
        state.final_answer = answer
        state.artifacts = artifacts
        state.log_path = log_path
        state.completed_at = _now()
        await _emit(state, "answer.completed", {"content": answer})
        await _emit(state, "run.completed", {"status": "completed", "artifacts": [artifact.model_dump() for artifact in artifacts], "log_path": log_path})
        logger.info("background run completed run_id=%s artifacts=%s log_path=%s", state.request.run_id, len(artifacts), log_path)
        await state.mark_completed("completed")
    except Exception as exc:
        state.error = str(exc)
        state.log_path = state.log_path or str(workspace_manager.log_path(state.request.thread_id, state.request.run_id))
        state.completed_at = _now()
        logger.exception("background run failed run_id=%s log_path=%s", state.request.run_id, state.log_path)
        await _emit(state, "run.failed", {"error": str(exc), "log_path": state.log_path})
        await state.mark_completed("failed")


def _persist_batch_state(state: BatchState) -> None:
    write_batch_status(settings.trace_root, state.response, trace_bucket=settings.trace_bucket)


def _run_batch_item(
    run_request: RunCreateRequest,
) -> tuple[str, list[ArtifactMetadata], str, list[dict], str | None]:
    activity_summary: list[dict] = []
    log_path = str(workspace_manager.log_path(run_request.thread_id, run_request.run_id))

    def emit_for_batch(event_type: str, payload: dict) -> None:
        if event_type not in INTERESTING_BATCH_EVENTS:
            return
        activity_summary.append({"type": event_type, "payload": payload})

    trace_summary_url = build_object_url(
        settings.trace_bucket,
        f"workspace-agent-traces/{run_request.thread_id}/{run_request.run_id}/summary.json",
    )

    try:
        answer, artifacts, _trace, returned_log_path, trace_summary_url = execute_run(
            run_request,
            settings,
            workspace_manager,
            emit_for_batch,
        )
        return answer, artifacts, returned_log_path, activity_summary, trace_summary_url
    except Exception as exc:
        raise BatchItemExecutionError(str(exc), activity_summary, log_path, trace_summary_url=trace_summary_url) from exc


def _build_batch_response(request: BatchCreateRequest) -> BatchStatusResponse:
    return BatchStatusResponse(
        batch_id=request.batch_id,
        thread_id=request.thread_id,
        user_id=request.user_id,
        status="accepted",
        item_count=len(request.items),
        max_concurrency=request.max_concurrency,
        items=[
            BatchItemResult(
                item_id=item.item_id,
                question=item.question,
                status="pending",
            )
            for item in request.items
        ],
        model=request.model,
        created_at=_now(),
    )


async def _mark_batch_item_started(state: BatchState, item: BatchItemResult, run_id: str) -> None:
    async with state.lock:
        item.run_id = run_id
        item.status = "in_progress"
        item.started_at = _now()
        _persist_batch_state(state)


async def _mark_batch_item_completed(
    state: BatchState,
    item: BatchItemResult,
    run_id: str,
    answer: str,
    artifacts: list[ArtifactMetadata],
    log_path: str,
    activity_summary: list[dict],
    trace_summary_url: str | None,
) -> None:
    async with state.lock:
        item.final_answer = answer
        item.artifacts = artifacts
        item.activity_summary = activity_summary
        item.log_path = log_path
        item.trace_summary_url = trace_summary_url
        item.status = "completed"
        item.completed_at = _now()
        _persist_batch_state(state)
    logger.info(
        "batch item completed batch_id=%s item_id=%s run_id=%s artifacts=%s",
        state.request.batch_id,
        item.item_id,
        run_id,
        len(artifacts),
    )


async def _mark_batch_item_failed(
    state: BatchState,
    item: BatchItemResult,
    run_id: str,
    exc: BatchItemExecutionError,
) -> None:
    async with state.lock:
        item.activity_summary = exc.activity_summary
        item.log_path = exc.log_path
        item.trace_summary_url = exc.trace_summary_url
        item.error = str(exc)
        item.status = "failed"
        item.completed_at = _now()
        _persist_batch_state(state)
    logger.exception(
        "batch item failed batch_id=%s item_id=%s run_id=%s log_path=%s",
        state.request.batch_id,
        item.item_id,
        run_id,
        exc.log_path,
    )


async def _run_batch_item_background(
    state: BatchState,
    item: BatchItemResult,
    semaphore: asyncio.Semaphore,
) -> None:
    async with semaphore:
        run_id = str(uuid.uuid4())
        await _mark_batch_item_started(state, item, run_id)

        run_request = RunCreateRequest(
            run_id=run_id,
            thread_id=state.request.thread_id,
            user_id=state.request.user_id,
            question=item.question,
            model=state.request.model,
            selected_files=state.request.selected_files,
            history=[],
            prior_context=None,
            prior_artifacts=[],
            compliance_context=None,
        )

        try:
            answer, artifacts, log_path, activity_summary, trace_summary_url = await asyncio.to_thread(
                _run_batch_item,
                run_request,
            )
            await _mark_batch_item_completed(
                state,
                item,
                run_id,
                answer,
                artifacts,
                log_path,
                activity_summary,
                trace_summary_url,
            )
        except BatchItemExecutionError as exc:
            await _mark_batch_item_failed(state, item, run_id, exc)


async def _run_batch_background(state: BatchState) -> None:
    state.response.status = "in_progress"
    state.response.started_at = _now()
    _persist_batch_state(state)

    semaphore = asyncio.Semaphore(max(1, state.request.max_concurrency))
    await asyncio.gather(
        *(
            _run_batch_item_background(state, item, semaphore)
            for item in state.response.items
        )
    )

    completed_items = sum(1 for item in state.response.items if item.status == "completed")
    failed_items = sum(1 for item in state.response.items if item.status == "failed")
    if failed_items and completed_items:
        state.response.status = "completed_with_errors"
    elif failed_items and not completed_items:
        state.response.status = "failed"
        state.response.error = "all_items_failed"
    else:
        state.response.status = "completed"
    state.response.completed_at = _now()
    _persist_batch_state(state)
    logger.info(
        "batch completed batch_id=%s status=%s max_concurrency=%s completed=%s failed=%s",
        state.request.batch_id,
        state.response.status,
        state.request.max_concurrency,
        completed_items,
        failed_items,
    )


@app.get("/", response_model=ApiIndexResponse, include_in_schema=False)
@app.get("/api/v1", response_model=ApiIndexResponse, tags=["System"], summary="Get API index")
async def api_index(request: Request) -> ApiIndexResponse:
    return ApiIndexResponse(
        service=SERVICE_NAME,
        version=API_VERSION,
        docs_url=_join_url(request, "/docs"),
        openapi_url=_join_url(request, "/openapi.json"),
        health_url=_join_url(request, "/api/v1/healthz"),
        readiness_url=_join_url(request, "/api/v1/readyz"),
        upload_files_url=_join_url(request, "/api/v1/files"),
        create_run_url=_join_url(request, "/api/v1/runs"),
        create_batch_url=_join_url(request, "/api/v1/batches"),
        eval_run_url=_join_url(request, "/api/v1/evals/run"),
        auth_scheme="X-API-Key header or Authorization: Bearer <api-key>",
    )


@app.get("/healthz", response_model=HealthResponse, include_in_schema=False)
@app.get("/api/v1/healthz", response_model=HealthResponse, tags=["System"], summary="Get liveness status")
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=SERVICE_NAME,
        version=API_VERSION,
        checks={
            "api": "ok",
            "workspace_root": "ok" if settings.workspace_root.exists() else "missing",
            "trace_root": "ok" if settings.trace_root.exists() else "missing",
        },
    )


@app.get("/readyz", response_model=HealthResponse, include_in_schema=False)
@app.get("/api/v1/readyz", response_model=HealthResponse, tags=["System"], summary="Get readiness status")
async def readyz() -> HealthResponse:
    checks = {
        "workspace_root": "ok" if settings.workspace_root.exists() else "missing",
        "trace_root": "ok" if settings.trace_root.exists() else "missing",
        "model_name": "ok" if bool(settings.model_name.strip()) else "missing",
    }
    status = "ready" if all(value == "ok" for value in checks.values()) else "not_ready"
    return HealthResponse(
        status=status,
        service=SERVICE_NAME,
        version=API_VERSION,
        checks=checks,
    )


@app.post("/api/v1/files", response_model=UploadFilesResponse, tags=["Files"], summary="Upload files for a thread")
async def upload_files(thread_id: str = Form(...), files: list[UploadFile] = File(...)) -> UploadFilesResponse:
    thread_id = _normalize_identifier(thread_id, "thread_id")
    if not files:
        raise HTTPException(status_code=400, detail="files must be non-empty")

    upload_root = settings.workspace_root / thread_id / "_shared" / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    uploaded_files: list[UploadFileResult] = []

    for upload in files:
        sanitized_name = _sanitize_upload_name(upload.filename)
        stored_name = f"{uuid.uuid4().hex}-{sanitized_name}"
        destination = upload_root / stored_name
        size_bytes = 0
        with destination.open("wb") as handle:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                handle.write(chunk)
        await upload.close()

        relative_workspace_path = destination.relative_to(settings.workspace_root).as_posix()
        file_suffix = Path(sanitized_name).suffix.lower().lstrip(".") or "bin"
        uploaded_files.append(
            UploadFileResult(
                file_id=f"upload-{uuid.uuid4().hex}",
                file_name=sanitized_name,
                file_type=file_suffix,
                relative_path=sanitized_name,
                workspace_staged_path=relative_workspace_path,
                file_url=f"local://upload/{relative_workspace_path}",
                size_bytes=size_bytes,
            )
        )

    logger.info("uploaded files thread_id=%s count=%s", thread_id, len(uploaded_files))
    return UploadFilesResponse(thread_id=thread_id, uploaded_files=uploaded_files)


@app.on_event("startup")
async def startup_event() -> None:
    global loop
    loop = asyncio.get_running_loop()
    settings.trace_root.mkdir(parents=True, exist_ok=True)
    recovered = recover_interrupted_batches(settings.trace_root, trace_bucket=settings.trace_bucket)
    logger.info(
        "agent executor startup workspace_root=%s artifacts_bucket=%s trace_bucket=%s model=%s openai_base_url=%s recovered_batches=%s auth_enabled=%s cors_origins=%s",
        settings.workspace_root,
        settings.artifacts_bucket,
        settings.trace_bucket,
        settings.model_name,
        settings.openai_base_url,
        len(recovered),
        bool(settings.api_keys),
        len(settings.cors_allowed_origins),
    )


@app.post("/runs", response_model=RunCreateResponse, include_in_schema=False)
@app.post("/api/v1/runs", response_model=RunCreateResponse, tags=["Runs"], summary="Create a run")
async def create_run(request: RunCreateRequest) -> RunCreateResponse:
    _validate_run_request(request)
    if request.run_id in run_registry:
        raise HTTPException(status_code=409, detail="run_id already exists")

    state = RunState(request=request)
    state.accepted_at = _now()
    run_registry[request.run_id] = state
    logger.info(
        "create_run accepted run_id=%s thread_id=%s user_id=%s selected_files=%s",
        request.run_id,
        request.thread_id,
        request.user_id,
        [item.file_name for item in request.selected_files],
    )
    asyncio.create_task(_run_background(state))
    paths = _build_run_paths(request.run_id)
    return RunCreateResponse(run_id=request.run_id, status="accepted", **paths)


@app.post("/evals/run", response_model=EvalRunResponse, include_in_schema=False)
@app.post("/api/v1/evals/run", response_model=EvalRunResponse, tags=["Evals"], summary="Run an eval scenario")
async def create_eval_run(request: EvalRunRequest, run_id: str | None = None) -> EvalRunResponse:
    logger.info(
        "create_eval_run accepted scenario_id=%s execution_mode=%s requested_run_id=%s",
        request.scenario.scenario_id,
        request.execution.mode,
        run_id or request.execution.run_id,
    )
    return await asyncio.to_thread(
        run_eval_request,
        request,
        settings,
        workspace_manager,
        run_id,
    )


@app.post("/batches", response_model=BatchCreateResponse, include_in_schema=False)
@app.post("/api/v1/batches", response_model=BatchCreateResponse, tags=["Batches"], summary="Create a batch")
async def create_batch(request: BatchCreateRequest) -> BatchCreateResponse:
    _validate_batch_request(request)
    if not request.selected_files:
        raise HTTPException(status_code=400, detail="selected_files must be non-empty")
    if not request.items:
        raise HTTPException(status_code=400, detail="items must be non-empty")
    if len({item.item_id for item in request.items}) != len(request.items):
        raise HTTPException(status_code=400, detail="item_id values must be unique")
    if any(not item.question.strip() for item in request.items):
        raise HTTPException(status_code=400, detail="item question must be non-empty")
    if request.batch_id in batch_registry or batch_exists(settings.trace_root, request.batch_id):
        raise HTTPException(status_code=409, detail="batch_id already exists")

    state = BatchState(request=request, response=_build_batch_response(request))
    batch_registry[request.batch_id] = state
    _persist_batch_state(state)
    logger.info(
        "create_batch accepted batch_id=%s thread_id=%s user_id=%s items=%s selected_files=%s",
        request.batch_id,
        request.thread_id,
        request.user_id,
        len(request.items),
        [item.file_name for item in request.selected_files],
    )
    asyncio.create_task(_run_batch_background(state))
    return BatchCreateResponse(
        batch_id=request.batch_id,
        status=state.response.status,
        thread_id=request.thread_id,
        item_count=len(request.items),
        status_path=_build_batch_status_path(request.batch_id),
    )


async def _stream_run(state: RunState) -> AsyncIterator[str]:
    cursor = 0
    while True:
        while cursor < len(state.events):
            event_type, payload = state.events[cursor]
            cursor += 1
            yield format_sse(event_type, payload)
        if state.completed:
            break
        async with state.condition:
            if cursor >= len(state.events) and not state.completed:
                await state.condition.wait()


@app.get("/api/v1/runs/{run_id}", response_model=RunStatusResponse, tags=["Runs"], summary="Get run status")
async def get_run(run_id: str) -> RunStatusResponse:
    state = run_registry.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="run not found")
    return _build_run_status_response(state)


@app.get("/runs/{run_id}/stream", include_in_schema=False)
@app.get("/api/v1/runs/{run_id}/stream", tags=["Runs"], summary="Stream run events")
async def stream_run(run_id: str) -> StreamingResponse:
    state = run_registry.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="run not found")
    logger.info("stream_run connected run_id=%s status=%s", run_id, state.status)
    return StreamingResponse(_stream_run(state), media_type="text/event-stream")


@app.get("/runs/{run_id}/artifacts", response_model=RunArtifactsResponse, include_in_schema=False)
@app.get("/api/v1/runs/{run_id}/artifacts", response_model=RunArtifactsResponse, tags=["Runs"], summary="List run artifacts")
async def list_artifacts(run_id: str) -> RunArtifactsResponse:
    state = run_registry.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="run not found")
    return RunArtifactsResponse(
        run_id=run_id,
        status=state.status,
        artifacts=state.artifacts,
        log_path=state.log_path,
    )


@app.get("/runs/{run_id}/logs", response_model=RunLogsResponse, include_in_schema=False)
@app.get("/api/v1/runs/{run_id}/logs", response_model=RunLogsResponse, tags=["Runs"], summary="Get run logs")
async def get_run_logs(run_id: str) -> RunLogsResponse:
    state = run_registry.get(run_id)
    if not state:
        raise HTTPException(status_code=404, detail="run not found")
    log_path = state.log_path or str(workspace_manager.log_path(state.request.thread_id, state.request.run_id))
    try:
        content = workspace_manager.log_path(state.request.thread_id, state.request.run_id).read_text(encoding="utf-8")
    except FileNotFoundError:
        content = ""
    return RunLogsResponse(
        run_id=run_id,
        status=state.status,
        log_path=log_path,
        content=content,
    )


@app.delete("/runs/{run_id}", response_model=DeleteRunResponse, include_in_schema=False)
@app.delete("/api/v1/runs/{run_id}", response_model=DeleteRunResponse, tags=["Runs"], summary="Delete run workspace")
async def delete_run(run_id: str) -> DeleteRunResponse:
    state = run_registry.pop(run_id, None)
    if not state:
        raise HTTPException(status_code=404, detail="run not found")
    workspace_manager.delete(state.request.thread_id, state.request.run_id)
    logger.info("deleted run workspace run_id=%s", run_id)
    return DeleteRunResponse(run_id=run_id, deleted=True)


@app.get("/batches/{batch_id}", response_model=BatchStatusResponse, include_in_schema=False)
@app.get("/api/v1/batches/{batch_id}", response_model=BatchStatusResponse, tags=["Batches"], summary="Get batch status")
async def get_batch(batch_id: str) -> BatchStatusResponse:
    state = batch_registry.get(batch_id)
    if state is not None:
        return state.response

    response = load_batch_status(settings.trace_root, batch_id)
    if response is None:
        raise HTTPException(status_code=404, detail="batch not found")
    return response


@app.get("/batches/{batch_id}/items/{item_id}", response_model=BatchItemResult, include_in_schema=False)
@app.get("/api/v1/batches/{batch_id}/items/{item_id}", response_model=BatchItemResult, tags=["Batches"], summary="Get batch item result")
async def get_batch_item(batch_id: str, item_id: str) -> BatchItemResult:
    state = batch_registry.get(batch_id)
    if state is not None:
        for item in state.response.items:
            if item.item_id == item_id:
                return item

    item = load_batch_item(settings.trace_root, batch_id, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="batch item not found")
    return item

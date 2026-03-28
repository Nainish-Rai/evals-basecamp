from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class EvalBaseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )


class SelectedFile(BaseModel):
    file_id: str
    file_name: str
    file_url: str
    file_type: str
    relative_path: str | None = None
    workspace_staged_path: str | None = None
    preprocessing_skipped: bool = False
    source_type: str | None = None


class HistoryMessage(BaseModel):
    role: str
    content: str


class PriorArtifact(BaseModel):
    name: str
    workspace_path: str | None = None
    artifact_type: str
    url: str
    mime_type: str | None = None
    size_bytes: int | None = None


class ComplianceTaskContext(BaseModel):
    task_type: str = "compliance_risk_assessment"
    target_workbook: str | None = None
    output_headers: list[str] = Field(default_factory=list)
    scoring_instructions: str | None = None
    evidence_requirements: list[str] = Field(default_factory=list)
    output_artifacts: list[str] = Field(default_factory=list)


class RunCreateRequest(BaseModel):
    run_id: str
    thread_id: str
    user_id: str
    question: str
    model: str | None = None
    selected_files: list[SelectedFile] = Field(default_factory=list)
    history: list[HistoryMessage] = Field(default_factory=list)
    prior_context: str | None = None
    prior_artifacts: list[PriorArtifact] = Field(default_factory=list)
    compliance_context: ComplianceTaskContext | None = None


class ArtifactMetadata(BaseModel):
    name: str
    workspace_path: str | None = None
    artifact_type: str
    url: str
    mime_type: str | None = None
    size_bytes: int | None = None
    local_path: str | None = None


class RunCreateResponse(BaseModel):
    run_id: str
    status: str
    stream_path: str
    status_path: str | None = None
    artifacts_path: str | None = None
    logs_path: str | None = None
    delete_path: str | None = None


class StreamEvent(BaseModel):
    type: str
    run_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)


class BatchItemRequest(BaseModel):
    item_id: str
    question: str


class BatchCreateRequest(BaseModel):
    batch_id: str
    thread_id: str
    user_id: str
    model: str | None = None
    max_concurrency: int = Field(default=1, ge=1, le=64)
    selected_files: list[SelectedFile] = Field(default_factory=list)
    items: list[BatchItemRequest] = Field(default_factory=list)


class BatchStatusCounts(BaseModel):
    total: int = 0
    pending: int = 0
    in_progress: int = 0
    completed: int = 0
    failed: int = 0


class BatchItemResult(BaseModel):
    item_id: str
    question: str
    status: str
    run_id: str | None = None
    final_answer: str | None = None
    artifacts: list[ArtifactMetadata] = Field(default_factory=list)
    activity_summary: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    log_path: str | None = None
    trace_summary_url: str | None = None


class BatchCreateResponse(BaseModel):
    batch_id: str
    status: str
    thread_id: str
    item_count: int
    status_path: str | None = None


class BatchStatusResponse(BaseModel):
    batch_id: str
    thread_id: str
    user_id: str
    status: str
    item_count: int
    max_concurrency: int = 1
    counts: BatchStatusCounts = Field(default_factory=BatchStatusCounts)
    items: list[BatchItemResult] = Field(default_factory=list)
    model: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    summary_url: str | None = None


class ApiIndexResponse(BaseModel):
    service: str
    version: str
    docs_url: str
    openapi_url: str
    health_url: str
    readiness_url: str
    upload_files_url: str
    create_run_url: str
    create_batch_url: str
    eval_run_url: str
    auth_scheme: str


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    checks: dict[str, str] = Field(default_factory=dict)


class RunStatusResponse(BaseModel):
    run_id: str
    thread_id: str
    user_id: str
    status: str
    stream_path: str
    final_answer: str | None = None
    artifacts: list[ArtifactMetadata] = Field(default_factory=list)
    error: str | None = None
    log_path: str | None = None
    accepted_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


class RunArtifactsResponse(BaseModel):
    run_id: str
    status: str
    artifacts: list[ArtifactMetadata] = Field(default_factory=list)
    log_path: str | None = None


class RunLogsResponse(BaseModel):
    run_id: str
    status: str
    log_path: str | None = None
    content: str = ""


class DeleteRunResponse(BaseModel):
    run_id: str
    deleted: bool


class UploadFileResult(BaseModel):
    file_id: str
    file_name: str
    file_type: str
    relative_path: str
    workspace_staged_path: str
    file_url: str
    size_bytes: int
    preprocessing_skipped: bool = False
    source_type: str = "upload"


class UploadFilesResponse(BaseModel):
    thread_id: str
    uploaded_files: list[UploadFileResult] = Field(default_factory=list)


class EvalExpectedOutcome(EvalBaseModel):
    finding_id: str
    summary: str
    severity: str
    required_evidence_refs: list[str] = Field(default_factory=list)
    required_policy_refs: list[str] = Field(default_factory=list)


class EvalScenario(EvalBaseModel):
    scenario_id: str
    title: str
    agent_family: str
    task_family: str
    difficulty: str
    modality_profile: list[str] = Field(default_factory=list)
    case_brief: str
    available_tools: list[str] = Field(default_factory=list)
    expected_outcomes: list[EvalExpectedOutcome] = Field(default_factory=list)


class EvalFeedbackTurn(EvalBaseModel):
    feedback_id: str
    turn_id: str
    source: str
    summary: str
    instructions: list[str] = Field(default_factory=list)
    corrected_facts: list[str] = Field(default_factory=list)
    priority: str | None = None
    resolution: str | None = None


class EvalArtifactSnapshot(EvalBaseModel):
    entry_id: str
    source_kind: str
    source_id: str
    title: str
    description: str
    relative_path: str
    content: str
    content_type: str


class EvalExecution(EvalBaseModel):
    mode: str
    run_id: str
    feedback_turns: list[EvalFeedbackTurn] = Field(default_factory=list)


class EvalEnvironment(EvalBaseModel):
    workspace_root: str
    artifact_snapshots: list[EvalArtifactSnapshot] = Field(default_factory=list)
    surfaced_context: dict[str, Any] = Field(default_factory=dict)
    surfaced_drift: dict[str, Any] = Field(default_factory=dict)
    surfaced_memory: dict[str, Any] | None = None


class EvalTraceContext(EvalBaseModel):
    trace_id: str | None = None
    enabled: bool = False


class EvalRunRequest(EvalBaseModel):
    scenario: EvalScenario
    execution: EvalExecution
    environment: EvalEnvironment
    trace_context: EvalTraceContext


class EvalTokenUsage(EvalBaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class EvalRunResponse(EvalBaseModel):
    summary: str
    output_artifacts: list[str] = Field(default_factory=list)
    token_usage: EvalTokenUsage = Field(default_factory=EvalTokenUsage)
    metadata: dict[str, Any] = Field(default_factory=dict)
    vendor_trace_id: str | None = None

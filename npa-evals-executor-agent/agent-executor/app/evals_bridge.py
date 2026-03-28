from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from .config import Settings
from .logging_utils import get_logger
from .observability import extract_usage_totals
from .run_agent import execute_run
from .schemas import (
    ArtifactMetadata,
    EvalRunRequest,
    EvalRunResponse,
    EvalTokenUsage,
    HistoryMessage,
    PriorArtifact,
    RunCreateRequest,
    SelectedFile,
)
from .workspace_manager import WorkspaceManager

logger = get_logger("agent_executor.evals_bridge")
USER_ID = "workspace-evals-agent"
DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
_eval_session_registry: dict[str, "EvalSessionState"] = {}


@dataclass
class EvalSessionState:
    history: list[HistoryMessage] = field(default_factory=list)
    prior_artifacts: list[PriorArtifact] = field(default_factory=list)
    last_answer: str | None = None


def run_eval_request(
    request: EvalRunRequest,
    settings: Settings,
    workspace_manager: WorkspaceManager,
    run_id_override: str | None = None,
) -> EvalRunResponse:
    run_id = _sanitize_identifier(run_id_override or request.execution.run_id)
    thread_id = _build_thread_id(request)
    question = _build_question(request)
    session = _eval_session_registry.setdefault(thread_id, EvalSessionState())
    selected_files = _stage_artifact_snapshots(request, settings, thread_id, run_id)
    run_request = RunCreateRequest(
        run_id=run_id,
        thread_id=thread_id,
        user_id=USER_ID,
        question=question,
        selected_files=selected_files,
        history=session.history[-6:],
        prior_context=_build_prior_context(request, session),
        prior_artifacts=session.prior_artifacts,
    )

    logger.info(
        "eval bridge accepted scenario_id=%s run_id=%s mode=%s thread_id=%s snapshots=%s",
        request.scenario.scenario_id,
        run_request.run_id,
        request.execution.mode,
        run_request.thread_id,
        len(request.environment.artifact_snapshots),
    )

    started_at = time.perf_counter()
    answer_text, artifacts, execution_trace, log_path, trace_summary_url = execute_run(
        run_request,
        settings,
        workspace_manager,
        lambda _event_type, _payload: None,
    )
    latency_ms = int((time.perf_counter() - started_at) * 1000)
    token_usage = _build_token_usage(
        execution_trace,
        question,
        answer_text,
        request.environment.artifact_snapshots,
    )

    session.history = [
        *session.history[-4:],
        HistoryMessage(role="user", content=question),
        HistoryMessage(role="assistant", content=answer_text),
    ][-6:]
    session.last_answer = answer_text
    session.prior_artifacts = [
        PriorArtifact(
            name=artifact.name,
            workspace_path=artifact.workspace_path,
            artifact_type=artifact.artifact_type,
            url=artifact.url,
            mime_type=artifact.mime_type,
            size_bytes=artifact.size_bytes,
        )
        for artifact in artifacts
    ]

    return EvalRunResponse(
        summary=answer_text.strip() or f"Completed {request.scenario.title}",
        output_artifacts=[artifact.workspace_path or artifact.name for artifact in artifacts],
        token_usage=token_usage,
        metadata=_build_metadata(
            request=request,
            run_request=run_request,
            execution_trace=execution_trace,
            artifacts=artifacts,
            log_path=log_path,
            trace_summary_url=trace_summary_url,
            latency_ms=latency_ms,
        ),
        vendor_trace_id=trace_summary_url or run_request.run_id,
    )


def _stage_artifact_snapshots(
    request: EvalRunRequest,
    settings: Settings,
    thread_id: str,
    run_id: str,
) -> list[SelectedFile]:
    staged_root = settings.workspace_root / "_eval_bridge" / thread_id / run_id / "snapshots"
    selected_files: list[SelectedFile] = []

    for snapshot in request.environment.artifact_snapshots:
        relative_path = _normalize_relative_path(snapshot.relative_path)
        staged_path = staged_root / relative_path
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        staged_path.write_text(snapshot.content, encoding="utf-8")
        selected_files.append(
            SelectedFile(
                file_id=snapshot.entry_id,
                file_name=relative_path.name,
                file_url=f"local://eval-bridge/{thread_id}/{run_id}/{relative_path.as_posix()}",
                file_type=_infer_file_type(relative_path, snapshot.content_type),
                relative_path=relative_path.as_posix(),
                workspace_staged_path=staged_path.relative_to(settings.workspace_root).as_posix(),
                source_type=snapshot.source_kind,
            )
        )

    return selected_files


def _build_prior_context(request: EvalRunRequest, session: EvalSessionState) -> str:
    lines = [
        f"Scenario ID: {request.scenario.scenario_id}",
        f"Execution mode: {request.execution.mode}",
        f"Primary case workspace: input/{request.environment.workspace_root}",
    ]
    if session.last_answer:
        lines.extend(
            [
                "",
                "Previous execution answer:",
                session.last_answer[:4000],
            ]
        )
    return "\n".join(lines)


def _build_question(request: EvalRunRequest) -> str:
    outcome_lines = [
        f"- {outcome.summary} (severity: {outcome.severity})"
        for outcome in request.scenario.expected_outcomes
    ] or ["- No explicit expected outcomes were provided."]
    tool_lines = [f"- {tool_name}" for tool_name in request.scenario.available_tools] or ["- none"]
    feedback_lines: list[str] = []
    if request.execution.feedback_turns:
        feedback_lines.extend(
            [
                "",
                "Reviewer feedback to incorporate now:",
            ]
        )
        for feedback_turn in request.execution.feedback_turns:
            feedback_lines.extend(
                [
                    f"- {feedback_turn.summary}",
                    *[f"  instruction: {instruction}" for instruction in feedback_turn.instructions],
                    *[f"  corrected fact: {fact}" for fact in feedback_turn.corrected_facts],
                ]
            )

    correctness_expectation = request.environment.surfaced_drift.get(
        "expectedOutcomeCriteria",
        {},
    ).get("correctnessExpectation")

    prompt_lines = [
        f"You are executing eval scenario `{request.scenario.scenario_id}`.",
        f"Title: {request.scenario.title}",
        f"Task family: {request.scenario.task_family}",
        f"Difficulty: {request.scenario.difficulty}",
        "",
        f"Primary case workspace: `input/{request.environment.workspace_root}`.",
        "Additional materialized scenario artifacts and references are also present under `input/`.",
        "",
        "Case brief:",
        request.scenario.case_brief,
        "",
        "Expected outcomes:",
        *outcome_lines,
        "",
        "Declared tool surface from the eval harness:",
        *tool_lines,
    ]

    if correctness_expectation:
        prompt_lines.extend(
            [
                "",
                "Correctness expectation:",
                str(correctness_expectation),
            ]
        )

    if request.execution.mode == "feedback_rerun":
        prompt_lines.extend(
            [
                "",
                "This is a feedback rerun. Reuse the prior thread context and prior artifacts when they help, but update the answer to incorporate the reviewer feedback.",
            ]
        )
    else:
        prompt_lines.extend(
            [
                "",
                "This is the initial run. Inspect the workspace and produce the best grounded answer you can.",
            ]
        )

    prompt_lines.extend(
        [
            *feedback_lines,
            "",
            "Answer directly from the workspace files. If you create artifacts, mention them in the final answer.",
        ]
    )

    return "\n".join(prompt_lines)


def _build_metadata(
    request: EvalRunRequest,
    run_request: RunCreateRequest,
    execution_trace: list[dict[str, Any]],
    artifacts: list[ArtifactMetadata],
    log_path: str,
    trace_summary_url: str | None,
    latency_ms: int,
) -> dict[str, Any]:
    subagent_events = _extract_subagent_events(execution_trace)
    token_usage = extract_usage_totals(execution_trace)
    return {
        "bridge": "workspace-agent-eval-bridge",
        "workspaceAgentRun": {
            "threadId": run_request.thread_id,
            "runId": run_request.run_id,
            "scenarioId": request.scenario.scenario_id,
            "executionMode": request.execution.mode,
            "artifactCount": len(artifacts),
            "logPath": log_path,
            "traceSummaryUrl": trace_summary_url,
        },
        "graphPath": _infer_graph_path(request, subagent_events),
        "groundedEvidenceRefs": [],
        "retrievalEvents": [],
        "subagentEvents": subagent_events,
        "memoryCandidatesObserved": [],
        "memoryReads": [],
        "memoryWrites": [],
        "memoryWritesSkipped": [],
        "contextMetrics": {
            "contextWindowSizeTokens": DEFAULT_CONTEXT_WINDOW_TOKENS,
            "promptTokens": token_usage["prompt_tokens"],
            "retrievedContextTokens": 0,
            "relevantContextTokens": 0,
            "unusedContextTokens": 0,
            "workspaceArtifactTokens": sum(
                _estimate_token_count(snapshot.content)
                for snapshot in request.environment.artifact_snapshots
            ),
            "subagentCommunicationTokens": 0,
        },
        "latencyMs": latency_ms,
    }


def _build_token_usage(
    execution_trace: list[dict[str, Any]],
    question: str,
    answer_text: str,
    snapshots: list[Any],
) -> EvalTokenUsage:
    totals = extract_usage_totals(execution_trace)
    if totals["total_tokens"] > 0:
        return EvalTokenUsage(
            input_tokens=totals["prompt_tokens"],
            output_tokens=totals["completion_tokens"],
            total_tokens=totals["total_tokens"],
        )

    fallback_input = _estimate_token_count(question) + sum(
        _estimate_token_count(snapshot.content[:4000]) for snapshot in snapshots[:8]
    )
    fallback_output = _estimate_token_count(answer_text)
    return EvalTokenUsage(
        input_tokens=fallback_input,
        output_tokens=fallback_output,
        total_tokens=fallback_input + fallback_output,
    )


def _extract_subagent_events(execution_trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queued_tasks: list[dict[str, Any]] = []
    subagent_events: list[dict[str, Any]] = []
    for event in execution_trace:
        event_type = event.get("type")
        tool_name = str(event.get("name") or "").lower()
        if event_type == "tool.start" and tool_name == "task":
            queued_tasks.append(event)
            continue
        if event_type not in {"tool.end", "tool.error"} or tool_name != "task":
            continue

        started = queued_tasks.pop(0) if queued_tasks else {}
        args = started.get("args") if isinstance(started.get("args"), dict) else {}
        metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        model = str(metadata.get("model") or "unknown")
        subagent_type = str(metadata.get("subagent_type") or args.get("subagent_type") or "task")
        description = str(
            args.get("description")
            or args.get("prompt")
            or f"Task delegation to {subagent_type}"
        )
        subagent_events.append(
            {
                "subagentId": f"{subagent_type}-{len(subagent_events) + 1}",
                "model": model,
                "modelTier": _infer_model_tier(model),
                "taskSummary": description[:500],
                "status": "completed" if event_type == "tool.end" else "failed",
            }
        )
    return subagent_events


def _infer_graph_path(
    request: EvalRunRequest,
    subagent_events: list[dict[str, Any]],
) -> list[str]:
    graph_path = ["planCaseWork"]
    if request.environment.artifact_snapshots:
        graph_path.append("curateWorkspace")
    if subagent_events:
        graph_path.append("delegateSubagent")
    if request.execution.mode == "feedback_rerun" or request.execution.feedback_turns:
        graph_path.append("applyFeedback")
    graph_path.append("composeFinalAnswer")
    return graph_path


def _infer_model_tier(model_name: str) -> str:
    lowered = model_name.lower()
    if any(token in lowered for token in {"mini", "small", "haiku", "flash", "nano"}):
        return "small"
    if any(token in lowered for token in {"medium", "sonnet"}):
        return "medium"
    if lowered == "unknown":
        return "medium"
    return "large"


def _infer_file_type(relative_path: PurePosixPath, content_type: str) -> str:
    suffix = relative_path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return suffix[1:]
    if suffix in {".csv", ".tsv", ".pdf", ".json"}:
        return suffix[1:]
    if suffix == ".md":
        return "md"
    if suffix == ".txt":
        return "txt"
    if content_type == "application/json":
        return "json"
    if content_type == "text/markdown":
        return "md"
    return "txt"


def _normalize_relative_path(value: str) -> PurePosixPath:
    candidate = PurePosixPath(value.strip())
    if candidate.is_absolute():
        raise ValueError(f"Artifact snapshot path must be relative: {value}")
    if any(part == ".." for part in candidate.parts):
        raise ValueError(f"Artifact snapshot path must not contain '..': {value}")
    parts = [part for part in candidate.parts if part not in {"", "."}]
    if not parts:
        raise ValueError("Artifact snapshot path cannot be empty")
    return PurePosixPath(*parts)


def _build_thread_id(request: EvalRunRequest) -> str:
    trace_or_run = request.trace_context.trace_id or request.execution.run_id
    return _sanitize_identifier(f"eval-{request.scenario.scenario_id}-{trace_or_run}")


def _sanitize_identifier(value: str) -> str:
    sanitized = "".join(
        character if character.isalnum() or character in {"-", "_", "."} else "-"
        for character in value.strip()
    )
    return sanitized[:160].strip("-._") or "workspace-eval"


def _estimate_token_count(text: str) -> int:
    return max(0, len(text) // 4)

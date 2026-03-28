from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    workspace_root: Path
    trace_root: Path
    artifacts_bucket: str
    trace_bucket: str
    minio_endpoint: str
    openai_base_url: str | None
    model_name: str
    max_steps: int
    request_timeout: float
    api_keys: tuple[str, ...]
    cors_allowed_origins: tuple[str, ...]
    public_base_url: str | None


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return None


def _detect_provider(model_name: str) -> str:
    lowered = model_name.lower()
    if lowered.startswith("opencode/"):
        return "opencode"
    if "minimax" in lowered:
        return "minimax"
    if lowered.startswith("groq/"):
        return "groq"
    return "openai"


def normalize_openai_base_url(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.rstrip("/")
    if normalized.endswith("/chat/completions"):
        normalized = normalized[: -len("/chat/completions")]
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


def _split_csv_env(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def resolve_model_name() -> str:
    return _first_env(
        "WORKSPACE_AGENT_MODEL",
        "MINIMAX_MODEL",
        "OPENCODE_MODEL",
        "OPENAI_MODEL",
        "LLM_MODEL_NAME",
    ) or "gpt-4o-mini"


def resolve_openai_base_url(model_name: str) -> str | None:
    provider = _detect_provider(model_name)
    if provider == "minimax":
        return normalize_openai_base_url(
            _first_env("MINIMAX_BASE_URL") or "https://api.minimax.io/v1"
        )
    if provider == "opencode":
        return normalize_openai_base_url(
            _first_env("OPENCODE_BASE_URL") or "https://opencode.ai/zen/v1"
        )
    if provider == "groq":
        return normalize_openai_base_url(
            _first_env("GROQ_BASE_URL") or "https://api.groq.com/openai/v1"
        )
    return normalize_openai_base_url(_first_env("OPENAI_BASE_URL", "LLM_BASE_URL"))


def get_settings() -> Settings:
    model_name = resolve_model_name()
    return Settings(
        workspace_root=Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve(),
        trace_root=Path(os.getenv("TRACE_ROOT", "/traces")).resolve(),
        artifacts_bucket=os.getenv("AGENT_ARTIFACTS_BUCKET", os.getenv("S3_BUCKET_NAME", "research-platform-bucket")),
        trace_bucket=os.getenv("AGENT_TRACE_BUCKET", "workspace-agent-traces-private"),
        minio_endpoint=os.getenv("MINIO_ENDPOINT", "http://minio:9000").rstrip("/"),
        openai_base_url=resolve_openai_base_url(model_name),
        model_name=model_name,
        max_steps=int(os.getenv("WORKSPACE_AGENT_MAX_STEPS", "32")),
        request_timeout=float(os.getenv("WORKSPACE_AGENT_REQUEST_TIMEOUT", "600")),
        api_keys=_split_csv_env(os.getenv("WORKSPACE_AGENT_API_KEYS")),
        cors_allowed_origins=_split_csv_env(os.getenv("WORKSPACE_AGENT_CORS_ALLOWED_ORIGINS")),
        public_base_url=os.getenv("WORKSPACE_AGENT_PUBLIC_BASE_URL", "").strip() or None,
    )

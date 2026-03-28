from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re


@dataclass(frozen=True)
class PromptPaths:
    repo_root: Path

    @property
    def local_prompt_dir(self) -> Path:
        return Path(__file__).resolve().parent / "prompts"

    @property
    def local_session_prompt_dir(self) -> Path:
        return self.local_prompt_dir / "session"

    @property
    def local_agent_prompt_dir(self) -> Path:
        return self.local_prompt_dir / "agent"

    @property
    def local_tool_prompt_dir(self) -> Path:
        return self.local_prompt_dir / "tool"

    @property
    def session_prompt_dir(self) -> Path:
        return self.repo_root / "packages" / "opencode" / "src" / "session" / "prompt"

    @property
    def agent_prompt_dir(self) -> Path:
        return self.repo_root / "packages" / "opencode" / "src" / "agent" / "prompt"

    @property
    def tool_prompt_dir(self) -> Path:
        return self.repo_root / "packages" / "opencode" / "src" / "tool"


def infer_repo_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for candidate in [current, *current.parents]:
        marker = candidate / "packages" / "opencode" / "src" / "session" / "prompt"
        if marker.exists():
            return candidate

    # Standalone opencode_py copies rely on bundled local prompts instead of
    # packages/opencode prompt files. In that case, use the nearest git root
    # (or cwd if none exists) as the runtime repo root.
    local_marker = Path(__file__).resolve().parent / "prompts" / "session"
    if local_marker.exists():
        for candidate in [current, *current.parents]:
            if (candidate / ".git").exists():
                return candidate
        return current

    raise FileNotFoundError("Could not find repo root containing packages/opencode/src/session/prompt")


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _read_first(paths: list[Path]) -> str:
    for path in paths:
        if path.exists():
            return path.read_text(encoding="utf-8")
    return ""


def _format_utc_offset(offset: str) -> str:
    if len(offset) == 5 and offset[0] in {"+", "-"} and offset[1:].isdigit():
        return f"{offset[:3]}:{offset[3:]}"
    return offset


def _prompt_template_values() -> dict[str, str]:
    now = datetime.now().astimezone()
    offset = _format_utc_offset(now.strftime("%z"))
    timezone = now.tzname() or "unknown"
    return {
        "year": now.strftime("%Y"),
        "month": now.strftime("%m"),
        "day": now.strftime("%d"),
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "datetime": f"{now.strftime('%Y-%m-%d %H:%M:%S')} {offset}",
        "timezone": timezone,
        "utc_offset": offset,
    }


def _render_prompt_template(text: str) -> str:
    values = _prompt_template_values()

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return values.get(key, match.group(0))

    return re.sub(r"\{\{([A-Za-z0-9_]+)\}\}", replace, text)


def load_session_prompt(repo_root: Path, name: str) -> str:
    prompt_paths = PromptPaths(repo_root)
    return _render_prompt_template(
        _read_first(
            [
                prompt_paths.local_session_prompt_dir / f"{name}.txt",
                prompt_paths.session_prompt_dir / f"{name}.txt",
            ],
        ),
    )


def load_agent_prompt(repo_root: Path, name: str) -> str:
    prompt_paths = PromptPaths(repo_root)
    return _render_prompt_template(
        _read_first(
            [
                prompt_paths.local_agent_prompt_dir / f"{name}.txt",
                prompt_paths.agent_prompt_dir / f"{name}.txt",
            ],
        ),
    )


def load_tool_description(repo_root: Path, tool_name: str) -> str:
    prompt_paths = PromptPaths(repo_root)
    return _render_prompt_template(
        _read_first(
            [
                prompt_paths.local_tool_prompt_dir / f"{tool_name}.txt",
                prompt_paths.tool_prompt_dir / f"{tool_name}.txt",
            ],
        ),
    )


def pick_provider_prompt_name(model_id: str) -> str:
    low = model_id.lower()
    if "gpt-5" in low:
        return "codex_header"
    if "gpt-" in low or "o1" in low or "o3" in low:
        return "beast"
    if "gemini-" in low:
        return "gemini"
    if "claude" in low:
        return "anthropic"
    if "trinity" in low:
        return "trinity"
    return "qwen"


def build_environment_prompt(cwd: Path, repo_root: Path, model_id: str) -> str:
    git_dir = repo_root / ".git"
    values = _prompt_template_values()
    return "\n".join(
        [
            f"You are powered by the model named {model_id}.",
            "Here is some useful information about the environment you are running in:",
            "<env>",
            f"  Working directory: {cwd}",
            f"  Is directory a git repo: {'yes' if git_dir.exists() else 'no'}",
            "  Platform: python",
            f"  Current date: {values['date']}",
            f"  Current time: {values['time']}",
            f"  Timezone: {values['timezone']} ({values['utc_offset']})",
            "</env>",
        ],
    )

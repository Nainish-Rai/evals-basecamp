from __future__ import annotations

import concurrent.futures
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

try:
    from .agents import AgentManager
    from .prompts import (
        build_environment_prompt,
        infer_repo_root,
        load_session_prompt,
        pick_provider_prompt_name,
    )
    from .tools import ToolContext, ToolRegistry, ToolResult
except ImportError:
    from agents import AgentManager
    from prompts import (
        build_environment_prompt,
        infer_repo_root,
        load_session_prompt,
        pick_provider_prompt_name,
    )
    from tools import ToolContext, ToolRegistry, ToolResult

try:
    from openai import OpenAI
except Exception:  # noqa: BLE001
    OpenAI = None  # type: ignore[assignment]


@dataclass
class ToolEvent:
    name: str
    arguments: dict[str, Any]
    result: ToolResult


@dataclass
class RunResult:
    text: str
    steps: int
    messages: list[dict[str, Any]] = field(default_factory=list)
    tool_events: list[ToolEvent] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)


class AgentRuntime:
    def __init__(
        self,
        repo_root: Path | None = None,
        workspace_root: Path | None = None,
        cwd: Path | None = None,
        interactive: bool = True,
        api_key: str | None = None,
        api_base: str | None = None,
        request_timeout: float | None = None,
    ):
        self.repo_root = (repo_root or infer_repo_root()).resolve()
        self.workspace_root = (workspace_root or Path.cwd()).resolve()
        self.cwd = (cwd or Path.cwd()).resolve()
        self.interactive = interactive

        self._load_env()

        self.agents = AgentManager(self.repo_root, self.workspace_root)
        self.tools = ToolRegistry(self.repo_root, self.workspace_root)

        self._api_key_override = api_key
        self._api_base_override = self._normalize_api_base(api_base)

        timeout = self._coerce_timeout(request_timeout)
        if timeout is None:
            timeout = self._coerce_timeout(os.getenv("OPENAI_TIMEOUT"))
        if timeout is None:
            timeout = self._coerce_timeout(os.getenv("OPENAI_REQUEST_TIMEOUT"))
        if timeout is None and os.getenv("GROQ_API_KEY"):
            timeout = self._coerce_timeout(os.getenv("GROQ_TIMEOUT"))
        if timeout is None:
            timeout = 120.0
        self.request_timeout = None if timeout == 0 else timeout

        self._client: OpenAI | None = None  # type: ignore[name-defined]
        self._client_signature: tuple[str | None, str | None, float | None] | None = None

    @staticmethod
    def _coerce_timeout(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        if parsed <= 0:
            return 0.0
        return parsed

    @staticmethod
    def _first_env(*names: str) -> str | None:
        for name in names:
            value = os.getenv(name)
            if value and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _normalize_api_base(value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.rstrip("/")
        if normalized.endswith("/chat/completions"):
            normalized = normalized[: -len("/chat/completions")]
        if normalized.endswith("/v1"):
            return normalized
        return f"{normalized}/v1"

    @staticmethod
    def _detect_provider(model_name: str) -> str:
        lowered = model_name.lower()
        if lowered.startswith("opencode/"):
            return "opencode"
        if "minimax" in lowered:
            return "minimax"
        if lowered.startswith("groq/"):
            return "groq"
        return "openai"

    def _resolve_api_key(self, model_name: str) -> str | None:
        if self._api_key_override:
            return self._api_key_override

        provider = self._detect_provider(model_name)
        if provider == "minimax":
            return self._first_env(
                "MINIMAX_API_KEY",
                "MINIMAX-API-KEY",
                "OPENAI_API_KEY",
                "LLM_API_KEY",
            )
        if provider == "opencode":
            return self._first_env("OPENCODE_API_KEY", "OPENAI_API_KEY", "LLM_API_KEY")
        if provider == "groq":
            return self._first_env("GROQ_API_KEY", "OPENAI_API_KEY", "LLM_API_KEY")
        return self._first_env("OPENAI_API_KEY", "LLM_API_KEY", "GROQ_API_KEY")

    def _resolve_api_base(self, model_name: str) -> str | None:
        if self._api_base_override:
            return self._api_base_override

        provider = self._detect_provider(model_name)
        if provider == "minimax":
            return self._normalize_api_base(
                self._first_env("MINIMAX_BASE_URL") or "https://api.minimax.io/v1"
            )
        if provider == "opencode":
            return self._normalize_api_base(
                self._first_env("OPENCODE_BASE_URL") or "https://opencode.ai/zen/v1"
            )
        if provider == "groq":
            return self._normalize_api_base(
                self._first_env("GROQ_BASE_URL") or "https://api.groq.com/openai/v1"
            )
        return self._normalize_api_base(self._first_env("OPENAI_BASE_URL", "LLM_BASE_URL"))

    def _resolve_request_model(self, model_name: str) -> str:
        provider = self._detect_provider(model_name)
        if provider == "opencode" and model_name.startswith("opencode/"):
            return model_name.split("/", 1)[1]
        return model_name

    def _load_env(self) -> None:
        candidates = [
            self.workspace_root / ".env",
            self.workspace_root / "opencode_py" / ".env",
            self.cwd / ".env",
            self.cwd / "opencode_py" / ".env",
        ]
        seen: set[Path] = set()
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            self._load_env_file(resolved)

    @staticmethod
    def _load_env_file(path: Path) -> None:
        if not path.exists() or not path.is_file():
            return

        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()

            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                continue

            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]

            os.environ.setdefault(key, value)

    @staticmethod
    def _context_tool_result_max_bytes() -> int:
        raw = os.getenv("AGENT_TOOL_RESULT_CONTEXT_MAX_BYTES", "12000").strip()
        try:
            value = int(raw)
        except ValueError:
            value = 12000
        return max(2000, value)

    @staticmethod
    def _truncate_for_context(text: str, max_bytes: int) -> tuple[str, bool]:
        raw = text.encode("utf-8")
        if len(raw) <= max_bytes:
            return text, False
        suffix = "\n\n...[truncated for model context]"
        suffix_bytes = suffix.encode("utf-8")
        budget = max(0, max_bytes - len(suffix_bytes))
        clipped = raw[:budget].decode("utf-8", errors="ignore")
        return clipped + suffix, True

    def _tool_message_content(self, tool_name: str, result: ToolResult) -> str:
        metadata_text = ""
        if result.metadata:
            metadata_text, metadata_truncated = self._truncate_for_context(
                json.dumps(result.metadata, ensure_ascii=False, sort_keys=True),
                1500,
            )
            if metadata_truncated:
                metadata_text += " [metadata truncated]"

        output_budget = self._context_tool_result_max_bytes()
        output_text, _ = self._truncate_for_context(result.output, output_budget)

        parts = [
            f"<tool_result name=\"{tool_name}\">",
            f"Title: {result.title}",
        ]
        if metadata_text:
            parts.append(f"Metadata: {metadata_text}")
        parts.append("Output:")
        parts.append(output_text)
        parts.append("</tool_result>")
        compacted = "\n".join(parts)
        final_text, _ = self._truncate_for_context(compacted, self._context_tool_result_max_bytes())
        return final_text

    def _client_for_model(self, model_name: str):
        if OpenAI is None:
            raise RuntimeError(
                "openai package is not installed. Install with: pip install -r requirements.txt",
            )

        api_key = self._resolve_api_key(model_name)
        if not api_key:
            raise RuntimeError("Missing API key. Set OPENAI_API_KEY, MINIMAX_API_KEY, or pass --api-key.")

        api_base = self._resolve_api_base(model_name)
        signature = (api_key, api_base, self.request_timeout)
        if self._client is None or self._client_signature != signature:
            kwargs: dict[str, Any] = {"api_key": api_key}
            if api_base:
                kwargs["base_url"] = api_base
            if self.request_timeout is not None:
                kwargs["timeout"] = self.request_timeout
            self._client = OpenAI(**kwargs)
            self._client_signature = signature
        return self._client

    def list_agents(self, include_hidden: bool = False):
        return self.agents.list(include_hidden=include_hidden)

    def list_tools(self, agent_name: str | None = None) -> list[str]:
        if not agent_name:
            return [t.name for t in self.tools.list()]
        agent = self.agents.get(agent_name)
        allowed = self._allowed_tool_names(agent_name=agent.name, task_depth=0)
        return sorted([name for name in allowed if agent.allows_tool(name)])

    def _allowed_tool_names(self, agent_name: str, task_depth: int) -> set[str]:
        agent = self.agents.get(agent_name)
        names = {t.name for t in self.tools.list()}
        if agent.tools_allow is not None:
            names &= set(agent.tools_allow)
        names -= set(agent.tools_deny)

        # Keep nested task recursion controlled.
        if task_depth >= 2 and "task" in names:
            names.remove("task")
        return names

    def _system_prompt(self, agent_name: str, model: str) -> str:
        provider_prompt_name = pick_provider_prompt_name(model)
        provider_prompt = load_session_prompt(self.repo_root, provider_prompt_name)
        env_prompt = build_environment_prompt(self.cwd, self.workspace_root, model)

        agent = self.agents.get(agent_name)
        parts = [provider_prompt.strip(), env_prompt.strip()]
        if agent.prompt.strip():
            parts.append(agent.prompt.strip())
        return "\n\n".join(part for part in parts if part)

    def run_tool(self, name: str, args: dict[str, Any], task_depth: int = 0) -> ToolResult:
        ctx = ToolContext(
            repo_root=self.repo_root,
            workspace_root=self.workspace_root,
            cwd=self.cwd,
            interactive=self.interactive,
            runtime=self,
            task_depth=task_depth,
        )
        return self.tools.execute(name, args, ctx)

    @staticmethod
    def _extract_json_object(text: str) -> dict[str, Any] | None:
        value = text.strip()
        if not value:
            return None

        fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", value, re.IGNORECASE)
        if fence:
            value = fence.group(1).strip()

        if value.startswith("{") and value.endswith("}"):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                return None

        start = value.find("{")
        end = value.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(value[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return None
        return None

    def _infer_tool_call(self, content: str, allowed_tools: set[str]) -> tuple[str, dict[str, Any]] | None:
        payload = self._extract_json_object(content)
        if not payload:
            return None

        direct_name = payload.get("tool") or payload.get("name")
        if isinstance(direct_name, str) and direct_name in allowed_tools:
            args = payload.get("parameters")
            if not isinstance(args, dict):
                args = payload.get("args")
            if not isinstance(args, dict):
                args = payload.get("arguments")
            if not isinstance(args, dict):
                args = payload.get("input")
            if not isinstance(args, dict):
                args = {
                    k: v
                    for k, v in payload.items()
                    if k not in {"tool", "name", "parameters", "args", "arguments", "input"}
                }
            return direct_name, args

        fn = payload.get("function")
        if isinstance(fn, dict):
            fn_name = fn.get("name")
            if isinstance(fn_name, str) and fn_name in allowed_tools:
                fn_args = fn.get("arguments")
                if isinstance(fn_args, str):
                    try:
                        parsed = json.loads(fn_args)
                        if isinstance(parsed, dict):
                            return fn_name, parsed
                    except json.JSONDecodeError:
                        pass
                if isinstance(fn_args, dict):
                    return fn_name, fn_args

        best_name: str | None = None
        best_score = -10_000
        payload_keys = set(payload.keys())
        if not payload_keys:
            return None

        for name in sorted(allowed_tools):
            try:
                spec = self.tools.get(name)
            except Exception:
                continue

            schema = spec.parameters
            properties = schema.get("properties")
            if not isinstance(properties, dict) or not properties:
                continue

            prop_keys = set(properties.keys())
            required_raw = schema.get("required", [])
            required = set(required_raw) if isinstance(required_raw, list) else set()
            if required and not required.issubset(payload_keys):
                continue

            overlap = len(payload_keys & prop_keys)
            unknown = len(payload_keys - prop_keys)
            if overlap == 0:
                continue
            if unknown > 2:
                continue

            score = overlap * 10 - unknown * 4 + (5 if required else 0)
            if score > best_score:
                best_score = score
                best_name = name

        if not best_name:
            return None
        if best_score < 6:
            return None
        return best_name, payload

    @staticmethod
    def _looks_like_invalid_workspace_answer(content: str, tool_events: list[ToolEvent]) -> bool:
        stripped = content.strip()
        if not stripped:
            return True

        lowered = stripped.lower()
        if (
            stripped.startswith("{")
            and (
                '"path"' in stripped
                or '"cmd"' in stripped
                or '"command"' in stripped
                or '"tool"' in stripped
                or '"filePath"' in stripped
            )
        ):
            return True
        if stripped.startswith("[") and stripped.endswith("]"):
            return True

        code_markers = [
            "import pandas",
            "import json",
            "def main(",
            "if __name__ ==",
            "pd.read_excel",
            "json.dump(",
            "with open(",
            "analysis/",
            "matplotlib.pyplot",
            "seaborn.",
        ]
        if any(marker in lowered for marker in code_markers):
            return True

        if "artifact:" in lowered and len(stripped) < 500:
            return True

        placeholder_phrases = [
            "you can open this file",
            "results saved as",
            "results are saved",
            "saved under `artifacts/",
            "saved in `artifacts/",
            "the report is saved",
            "artifact created",
            "artifacts created",
            "generated artifact",
            "the results have been saved",
            "open this file to see",
        ]
        if any(phrase in lowered for phrase in placeholder_phrases):
            return True

        if stripped.startswith("<path>") or stripped.startswith("/workspace/"):
            return True

        if len(stripped) < 80 and len(tool_events) >= 2:
            return True

        if not tool_events:
            return True

        return False

    def run(
        self,
        user_prompt: str,
        agent: str = "build",
        model: str | None = None,
        max_steps: int = 32,
        task_depth: int = 0,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> RunResult:
        def emit(event_type: str, **payload: Any) -> None:
            if on_event is None:
                return
            on_event({"type": event_type, **payload})

        def extract_usage(response: Any) -> dict[str, int]:
            usage = getattr(response, "usage", None)
            if usage is None:
                return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            prompt_tokens = getattr(usage, "prompt_tokens", None)
            completion_tokens = getattr(usage, "completion_tokens", None)
            total_tokens = getattr(usage, "total_tokens", None)
            if isinstance(usage, dict):
                prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                completion_tokens = usage.get("completion_tokens", completion_tokens)
                total_tokens = usage.get("total_tokens", total_tokens)
            return {
                "prompt_tokens": int(prompt_tokens or 0),
                "completion_tokens": int(completion_tokens or 0),
                "total_tokens": int(total_tokens or 0),
            }

        model_name = (
            model
            or os.getenv("MINIMAX_MODEL")
            or os.getenv("OPENCODE_MODEL")
            or os.getenv("OPENAI_MODEL")
            or os.getenv("GROQ_MODEL")
            or "gpt-4o-mini"
        )
        agent_spec = self.agents.get(agent)
        allowed_tools = self._allowed_tool_names(agent_name=agent_spec.name, task_depth=task_depth)
        emit(
            "run.start",
            agent=agent_spec.name,
            model=model_name,
            max_steps=max_steps,
            allowed_tools=sorted(allowed_tools),
            task_depth=task_depth,
            request_timeout=self.request_timeout,
        )

        tools_def = self.tools.openai_tools(allowed=allowed_tools)
        system = self._system_prompt(agent_spec.name, model_name)
        request_model = self._resolve_request_model(model_name)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ]

        tool_events: list[ToolEvent] = []
        total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        client = self._client_for_model(model_name)

        for step in range(1, max_steps + 1):
            emit("step.start", step=step, message_count=len(messages))
            step_started = time.time()
            request: dict[str, Any] = {
                "model": request_model,
                "messages": messages,
                "tools": tools_def,
                "tool_choice": "auto",
                "temperature": 0,
            }
            if self.request_timeout is not None:
                request["timeout"] = self.request_timeout
            try:
                response = client.chat.completions.create(**request)
            except KeyboardInterrupt:
                emit(
                    "run.finish",
                    reason="interrupted",
                    step=step,
                    text_preview="",
                    tool_events=len(tool_events),
                    usage=total_usage,
                )
                raise
            except Exception as exc:  # noqa: BLE001
                emit(
                    "run.finish",
                    reason="error",
                    step=step,
                    error=str(exc),
                    text_preview="",
                    tool_events=len(tool_events),
                    usage=total_usage,
                )
                raise

            choice = response.choices[0]
            message = choice.message
            usage = extract_usage(response)
            total_usage["prompt_tokens"] += usage["prompt_tokens"]
            total_usage["completion_tokens"] += usage["completion_tokens"]
            total_usage["total_tokens"] += usage["total_tokens"]
            emit(
                "step.response",
                step=step,
                finish_reason=choice.finish_reason,
                has_tool_calls=bool(message.tool_calls),
                content_preview=(message.content or "")[:200],
                usage=usage,
                latency_ms=int((time.time() - step_started) * 1000),
            )

            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": message.content or "",
            }

            if message.tool_calls:
                emit(
                    "step.tool_calls",
                    step=step,
                    count=len(message.tool_calls),
                    tools=[call.function.name for call in message.tool_calls],
                )
                assistant_message["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in message.tool_calls
                ]
                messages.append(assistant_message)

                prepared_calls: list[tuple[Any, str, dict[str, Any]]] = []
                for call in message.tool_calls:
                    try:
                        parsed_args = json.loads(call.function.arguments or "{}")
                        if not isinstance(parsed_args, dict):
                            parsed_args = {"value": parsed_args}
                    except json.JSONDecodeError:
                        parsed_args = {
                            "tool": call.function.name,
                            "error": "Invalid JSON arguments",
                        }
                        call_name = "invalid"
                    else:
                        call_name = call.function.name
                    prepared_calls.append((call, call_name, parsed_args))
                    emit("tool.start", step=step, name=call_name, args=parsed_args, source="provider")

                def _execute_prepared_call(call_name: str, parsed_args: dict[str, Any]) -> ToolResult:
                    ctx = ToolContext(
                        repo_root=self.repo_root,
                        workspace_root=self.workspace_root,
                        cwd=self.cwd,
                        interactive=self.interactive,
                        runtime=self,
                        task_depth=task_depth,
                    )
                    return self.tools.execute(call_name, parsed_args, ctx)

                parallel_task_batch = len(prepared_calls) > 1 and all(call_name == "task" for _, call_name, _ in prepared_calls)
                executed_results: list[tuple[Any, str, dict[str, Any], ToolResult, Exception | None]] = []

                if parallel_task_batch:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=len(prepared_calls)) as executor:
                        future_map = {
                            executor.submit(_execute_prepared_call, call_name, parsed_args): (call, call_name, parsed_args)
                            for call, call_name, parsed_args in prepared_calls
                        }
                        result_by_call_id: dict[str, tuple[Any, str, dict[str, Any], ToolResult, Exception | None]] = {}
                        for future, original in future_map.items():
                            call, call_name, parsed_args = original
                            try:
                                result = future.result()
                                result_by_call_id[call.id] = (call, call_name, parsed_args, result, None)
                            except Exception as exc:  # noqa: BLE001
                                result_by_call_id[call.id] = (
                                    call,
                                    call_name,
                                    parsed_args,
                                    ToolResult(
                                        title="Tool error",
                                        output=f"{call_name} failed: {exc}",
                                        metadata={"error": str(exc)},
                                    ),
                                    exc,
                                )
                        executed_results = [result_by_call_id[call.id] for call, _, _ in prepared_calls]
                else:
                    for call, call_name, parsed_args in prepared_calls:
                        try:
                            result = _execute_prepared_call(call_name, parsed_args)
                            executed_results.append((call, call_name, parsed_args, result, None))
                        except Exception as exc:  # noqa: BLE001
                            executed_results.append(
                                (
                                    call,
                                    call_name,
                                    parsed_args,
                                    ToolResult(
                                        title="Tool error",
                                        output=f"{call_name} failed: {exc}",
                                        metadata={"error": str(exc)},
                                    ),
                                    exc,
                                ),
                            )

                for call, call_name, parsed_args, result, exc in executed_results:
                    if exc is None:
                        emit(
                            "tool.end",
                            step=step,
                            name=call_name,
                            source="provider",
                            title=result.title,
                            output_preview=result.output[:200],
                            metadata=result.metadata,
                        )
                    else:
                        emit(
                            "tool.error",
                            step=step,
                            name=call_name,
                            source="provider",
                            error=str(exc),
                        )

                    tool_events.append(ToolEvent(name=call_name, arguments=parsed_args, result=result))
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "name": call_name,
                            "content": self._tool_message_content(call_name, result),
                        },
                    )

                continue

            inferred = self._infer_tool_call(message.content or "", allowed_tools)
            if inferred:
                call_name, parsed_args = inferred
                emit("tool.inferred", step=step, name=call_name, args=parsed_args)
                messages.append(assistant_message)

                ctx = ToolContext(
                    repo_root=self.repo_root,
                    workspace_root=self.workspace_root,
                    cwd=self.cwd,
                    interactive=self.interactive,
                    runtime=self,
                    task_depth=task_depth,
                )

                try:
                    emit("tool.start", step=step, name=call_name, args=parsed_args, source="inferred")
                    result = self.tools.execute(call_name, parsed_args, ctx)
                    emit(
                        "tool.end",
                        step=step,
                        name=call_name,
                        source="inferred",
                        title=result.title,
                        output_preview=result.output[:200],
                        metadata=result.metadata,
                    )
                except Exception as exc:  # noqa: BLE001
                    result = ToolResult(
                        title="Tool error",
                        output=f"{call_name} failed: {exc}",
                        metadata={"error": str(exc)},
                    )
                    emit(
                        "tool.error",
                        step=step,
                        name=call_name,
                        source="inferred",
                        error=str(exc),
                    )

                tool_events.append(ToolEvent(name=call_name, arguments=parsed_args, result=result))
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "<system-reminder>\n"
                            "Your previous message appeared to contain tool arguments rather than an explicit "
                            "OpenAI tool-call envelope. The runtime inferred and executed the tool below.\n"
                            f"Tool: {call_name}\n"
                            f"Input: {json.dumps(parsed_args, ensure_ascii=False)}\n"
                            f"Output:\n{self._tool_message_content(call_name, result)}\n"
                            "</system-reminder>"
                        ),
                    },
                )
                continue

            content = message.content or ""
            if (
                agent_spec.name == "workspace_analyst"
                and step < max_steps
                and self._looks_like_invalid_workspace_answer(content, tool_events)
            ):
                messages.append(assistant_message)
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "<system-reminder>\n"
                            "That is not a valid final answer yet.\n"
                            "- Behave like a data analyst, not a file generator.\n"
                            "- Do not output raw code, import statements, script contents, JSON payloads, or path blobs.\n"
                            "- Do not stop after only creating an artifact or script.\n"
                            "- If you created a .py script in analysis/, run it and use its outputs before answering.\n"
                            "- Reuse profiles/, cache/cleaned/, and cache/prior_artifacts/ if they already contain the needed intermediate data.\n"
                            "- Read the workbook data or generated artifact and answer the user's actual question directly.\n"
                            "- If the user asked for statistics, EDA, trends, regression, or comparison, include the findings and interpretation.\n"
                            "- If the user asked for graphs or a report, mention the saved artifacts but still provide the analytical answer in chat.\n"
                            "- If the user asked about a specific annexure or sheet, inspect that exact sheet now before answering.\n"
                            "</system-reminder>"
                        ),
                    },
                )
                emit(
                    "step.reminder",
                    step=step,
                    reason="invalid_workspace_answer",
                    content_preview=content[:300],
                    tool_events=len(tool_events),
                )
                continue

            messages.append(assistant_message)
            emit(
                "run.finish",
                reason="assistant_text",
                step=step,
                text_preview=content[:300],
                tool_events=len(tool_events),
                usage=total_usage,
            )
            return RunResult(
                text=content,
                steps=step,
                messages=messages,
                tool_events=tool_events,
                usage=total_usage,
            )

        emit("run.finish", reason="max_steps", step=max_steps, text_preview="", tool_events=len(tool_events), usage=total_usage)
        return RunResult(
            text=f"Maximum steps reached ({max_steps}).",
            steps=max_steps,
            messages=messages,
            tool_events=tool_events,
            usage=total_usage,
        )

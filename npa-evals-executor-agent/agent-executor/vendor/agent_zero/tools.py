from __future__ import annotations

import concurrent.futures
import difflib
import fnmatch
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable

try:
    from .prompts import load_tool_description
except ImportError:
    from prompts import load_tool_description


DEFAULT_IGNORE_PATTERNS = [
    ".git/",
    "node_modules/",
    "dist/",
    "build/",
    "coverage/",
    "__pycache__/",
    ".venv/",
    "venv/",
    "tmp/",
    "temp/",
]

MAX_OUTPUT_BYTES = 120_000
MAX_READ_BYTES = 50 * 1024
DEFAULT_SUBAGENT_MAX_STEPS = 20
MAX_SUBAGENT_MAX_STEPS = 32


class ToolExecutionError(RuntimeError):
    pass


@dataclass
class ToolResult:
    title: str
    output: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolContext:
    repo_root: Path
    workspace_root: Path
    cwd: Path
    interactive: bool = True
    runtime: Any | None = None
    task_depth: int = 0

    @property
    def state_dir(self) -> Path:
        path = self.workspace_root / ".opencode_py"
        path.mkdir(parents=True, exist_ok=True)
        return path


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any], ToolContext], ToolResult]


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)

    def text(self) -> str:
        out = "".join(self.parts)
        out = re.sub(r"\n{3,}", "\n\n", out)
        return out.strip()


class ToolRegistry:
    def __init__(self, repo_root: Path, workspace_root: Path):
        self.repo_root = repo_root
        self.workspace_root = workspace_root
        self._tools: dict[str, ToolSpec] = {}
        self._register_builtins()

    def list(self) -> list[ToolSpec]:
        return [self._tools[name] for name in sorted(self._tools)]

    def get(self, name: str) -> ToolSpec:
        if name not in self._tools:
            raise ToolExecutionError(f"Unknown tool: {name}")
        return self._tools[name]

    def openai_tools(self, allowed: set[str] | None = None) -> list[dict[str, Any]]:
        names = sorted(self._tools)
        if allowed is not None:
            names = [name for name in names if name in allowed]
        return [
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": self._tools[name].description,
                    "parameters": self._tools[name].parameters,
                },
            }
            for name in names
        ]

    def execute(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        spec = self.get(name)
        try:
            return spec.handler(args, ctx)
        except ToolExecutionError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ToolExecutionError(f"{name} failed: {exc}") from exc

    def _desc(self, tool_name: str, fallback: str) -> str:
        text = load_tool_description(self.repo_root, tool_name).strip()
        return text or fallback

    def _add(
        self,
        name: str,
        parameters: dict[str, Any],
        handler: Callable[[dict[str, Any], ToolContext], ToolResult],
        fallback_description: str,
    ) -> None:
        self._tools[name] = ToolSpec(
            name=name,
            description=self._desc(name, fallback_description),
            parameters=parameters,
            handler=handler,
        )

    def _register_builtins(self) -> None:
        self._add(
            "invalid",
            {
                "type": "object",
                "properties": {
                    "tool": {"type": "string"},
                    "error": {"type": "string"},
                },
                "required": ["tool", "error"],
            },
            self._invalid,
            "Do not use.",
        )
        self._add(
            "question",
            {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "question": {"type": "string"},
                                "header": {"type": "string"},
                                "multiple": {"type": "boolean"},
                                "options": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {"type": "string"},
                                            "description": {"type": "string"},
                                        },
                                        "required": ["label"],
                                    },
                                },
                            },
                            "required": ["question", "options"],
                        },
                    },
                },
                "required": ["questions"],
            },
            self._question,
            "Ask the user clarifying questions.",
        )
        self._add(
            "bash",
            {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "timeout": {"type": "number"},
                    "workdir": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["command"],
            },
            self._bash,
            "Execute shell command.",
        )
        self._add(
            "read",
            {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string"},
                    "offset": {"type": "integer"},
                    "limit": {"type": "integer"},
                },
                "required": ["filePath"],
            },
            self._read,
            "Read a file or directory.",
        )
        self._add(
            "glob",
            {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["pattern"],
            },
            self._glob,
            "Glob files by pattern.",
        )
        self._add(
            "grep",
            {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "include": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["pattern"],
            },
            self._grep,
            "Search text by regex.",
        )
        self._add(
            "edit",
            {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string"},
                    "oldString": {"type": "string"},
                    "newString": {"type": "string"},
                    "replaceAll": {"type": "boolean"},
                },
                "required": ["filePath", "oldString", "newString"],
            },
            self._edit,
            "Replace text in file.",
        )
        self._add(
            "write",
            {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["filePath", "content"],
            },
            self._write,
            "Write file content.",
        )
        self._add(
            "task",
            {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "prompt": {"type": "string"},
                    "subagent_type": {"type": "string"},
                    "model": {"type": "string"},
                    "task_id": {"type": "string"},
                    "command": {"type": "string"},
                    "max_steps": {"type": "integer"},
                },
                "required": ["description", "prompt", "subagent_type"],
            },
            self._task,
            "Run a subagent task.",
        )
        self._add(
            "todowrite",
            {
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "content": {"type": "string"},
                                "status": {"type": "string"},
                                "priority": {"type": "string"},
                            },
                            "required": ["content", "status"],
                        },
                    },
                },
                "required": ["todos"],
            },
            self._todowrite,
            "Write todo list.",
        )
        self._add(
            "todoread",
            {"type": "object", "properties": {}},
            self._todoread,
            "Read todo list.",
        )
        self._add(
            "webfetch",
            {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "format": {"type": "string", "enum": ["text", "markdown", "html"]},
                    "timeout": {"type": "number"},
                },
                "required": ["url"],
            },
            self._webfetch,
            "Fetch URL content.",
        )
        self._add(
            "websearch",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "numResults": {"type": "number"},
                    "livecrawl": {"type": "string", "enum": ["fallback", "preferred"]},
                    "type": {"type": "string", "enum": ["auto", "fast", "deep"]},
                    "contextMaxCharacters": {"type": "number"},
                },
                "required": ["query"],
            },
            self._websearch,
            "Search web via Exa MCP endpoint.",
        )
        self._add(
            "codesearch",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "tokensNum": {"type": "number", "minimum": 1000, "maximum": 50000},
                },
                "required": ["query"],
            },
            self._codesearch,
            "Search code context via Exa MCP endpoint.",
        )
        self._add(
            "skill",
            {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                },
                "required": ["name"],
            },
            self._skill,
            "Load a skill by name.",
        )
        self._add(
            "apply_patch",
            {
                "type": "object",
                "properties": {
                    "patchText": {"type": "string"},
                },
                "required": ["patchText"],
            },
            self._apply_patch,
            "Apply custom patch format.",
        )
        self._add(
            "list",
            {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "ignore": {"type": "array", "items": {"type": "string"}},
                },
            },
            self._list,
            "List files/directories.",
        )
        self._add(
            "multiedit",
            {
                "type": "object",
                "properties": {
                    "filePath": {"type": "string"},
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "oldString": {"type": "string"},
                                "newString": {"type": "string"},
                                "replaceAll": {"type": "boolean"},
                            },
                            "required": ["oldString", "newString"],
                        },
                    },
                },
                "required": ["filePath", "edits"],
            },
            self._multiedit,
            "Apply multiple edits to one file.",
        )
        self._add(
            "batch",
            {
                "type": "object",
                "properties": {
                    "tool_calls": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tool": {"type": "string"},
                                "parameters": {"type": "object"},
                            },
                            "required": ["tool", "parameters"],
                        },
                    },
                },
                "required": ["tool_calls"],
            },
            self._batch,
            "Run multiple tools in parallel.",
        )
        self._add(
            "plan_enter",
            {"type": "object", "properties": {}},
            self._plan_enter,
            "Suggest switching to plan mode.",
        )
        self._add(
            "plan_exit",
            {"type": "object", "properties": {}},
            self._plan_exit,
            "Exit plan mode and switch to build.",
        )
        self._add(
            "lsp",
            {
                "type": "object",
                "properties": {
                    "operation": {"type": "string"},
                    "filePath": {"type": "string"},
                    "line": {"type": "number"},
                    "character": {"type": "number"},
                },
                "required": ["operation", "filePath", "line", "character"],
            },
            self._lsp,
            "LSP operations (stub).",
        )

    @staticmethod
    def _resolve_path(ctx: ToolContext, raw: str | None) -> Path:
        if not raw:
            candidate = ctx.cwd
        else:
            p = Path(raw).expanduser()
            if p.is_absolute():
                candidate = p.resolve()
            else:
                candidate = (ctx.cwd / p).resolve()
        workspace_root = ctx.workspace_root.resolve()
        try:
            candidate.relative_to(workspace_root)
        except ValueError as exc:
            raise ToolExecutionError(f"path is outside the workspace root: {candidate}") from exc
        return candidate

    @staticmethod
    def _truncate_text(text: str, max_bytes: int = MAX_OUTPUT_BYTES) -> tuple[str, bool]:
        raw = text.encode("utf-8", errors="ignore")
        if len(raw) <= max_bytes:
            return text, False
        return raw[:max_bytes].decode("utf-8", errors="ignore") + "\n\n...[truncated]", True

    @staticmethod
    def _is_binary(path: Path) -> bool:
        try:
            data = path.read_bytes()[:4096]
        except Exception:
            return False
        if b"\x00" in data:
            return True
        if not data:
            return False
        control = sum(1 for b in data if b < 9 or (13 < b < 32))
        return control / max(len(data), 1) > 0.3

    @staticmethod
    def _diff(old: str, new: str, file_path: str) -> str:
        return "".join(
            difflib.unified_diff(
                old.splitlines(keepends=True),
                new.splitlines(keepends=True),
                fromfile=file_path,
                tofile=file_path,
            ),
        )

    @staticmethod
    def _validate_edit(file_text: str, old: str, replace_all: bool) -> tuple[int, str]:
        count = file_text.count(old)
        if count == 0:
            raise ToolExecutionError("oldString not found in content")
        if count > 1 and not replace_all:
            raise ToolExecutionError(
                "Found multiple matches for oldString. Provide more surrounding lines or set replaceAll=true.",
            )
        return count, file_text

    def _invalid(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        tool = str(args.get("tool", "unknown"))
        error = str(args.get("error", "invalid arguments"))
        return ToolResult(title="Invalid tool", output=f"The arguments provided to {tool} are invalid: {error}")

    def _question(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        questions = args.get("questions", [])
        if not isinstance(questions, list) or not questions:
            raise ToolExecutionError("questions must be a non-empty list")

        answers: list[list[str]] = []
        for item in questions:
            if not isinstance(item, dict):
                answers.append(["Unanswered"])
                continue

            prompt = str(item.get("question", "Question"))
            options = item.get("options", [])
            labels = [str(opt.get("label", "")) for opt in options if isinstance(opt, dict) and opt.get("label")]
            multiple = bool(item.get("multiple", False))

            if not labels:
                answers.append(["Unanswered"])
                continue

            if not ctx.interactive:
                answers.append([labels[0]])
                continue

            print(f"\n[question] {prompt}")
            for i, label in enumerate(labels, start=1):
                print(f"  {i}. {label}")

            if multiple:
                raw = input("Select one or more options (comma-separated, default 1): ").strip()
                if not raw:
                    answers.append([labels[0]])
                    continue
                selected: list[str] = []
                for token in raw.split(","):
                    token = token.strip()
                    if token.isdigit():
                        idx = int(token) - 1
                        if 0 <= idx < len(labels):
                            selected.append(labels[idx])
                answers.append(selected or [labels[0]])
            else:
                raw = input("Select option (default 1): ").strip()
                if not raw:
                    answers.append([labels[0]])
                    continue
                if raw.isdigit():
                    idx = int(raw) - 1
                    if 0 <= idx < len(labels):
                        answers.append([labels[idx]])
                        continue
                answers.append([labels[0]])

        formatted = ", ".join(
            f'"{q.get("question", "")}"="{", ".join(ans)}"'
            for q, ans in zip(questions, answers, strict=False)
            if isinstance(q, dict)
        )
        return ToolResult(
            title=f"Asked {len(questions)} question(s)",
            output=f"User has answered your questions: {formatted}",
            metadata={"answers": answers},
        )

    def _bash(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        command = args.get("command")
        if not isinstance(command, str) or not command.strip():
            raise ToolExecutionError("command is required")

        timeout_ms = int(args.get("timeout", 120000))
        if timeout_ms <= 0:
            raise ToolExecutionError("timeout must be > 0")

        workdir = self._resolve_path(ctx, args.get("workdir"))
        if not workdir.exists() or not workdir.is_dir():
            raise ToolExecutionError(f"workdir is not a directory: {workdir}")

        description = str(args.get("description", command))
        start = time.time()
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(workdir),
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000,
                executable=os.environ.get("SHELL"),
            )
            output = (proc.stdout or "") + (proc.stderr or "")
            output, truncated = self._truncate_text(output)
            return ToolResult(
                title=description,
                output=output,
                metadata={
                    "exit": proc.returncode,
                    "elapsed_ms": int((time.time() - start) * 1000),
                    "truncated": truncated,
                },
            )
        except subprocess.TimeoutExpired as exc:
            output = (exc.stdout or "") + (exc.stderr or "") + "\n\n<bash_metadata>\nTimed out\n</bash_metadata>"
            output, truncated = self._truncate_text(output)
            return ToolResult(
                title=description,
                output=output,
                metadata={
                    "exit": None,
                    "timed_out": True,
                    "elapsed_ms": int((time.time() - start) * 1000),
                    "truncated": truncated,
                },
            )

    def _read(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        file_path = args.get("filePath")
        if not isinstance(file_path, str) or not file_path:
            raise ToolExecutionError("filePath is required")

        offset = int(args.get("offset", 1))
        limit = int(args.get("limit", 2000))
        if offset < 1:
            raise ToolExecutionError("offset must be >= 1")
        if limit < 1:
            raise ToolExecutionError("limit must be >= 1")

        path = self._resolve_path(ctx, file_path)
        if not path.exists():
            raise ToolExecutionError(f"File not found: {path}")

        if path.is_dir():
            entries = sorted([p.name + ("/" if p.is_dir() else "") for p in path.iterdir()], key=str.lower)
            start = offset - 1
            sliced = entries[start : start + limit]
            truncated = start + len(sliced) < len(entries)
            body = "\n".join(sliced)
            suffix = (
                f"\n(Showing {len(sliced)} of {len(entries)} entries. Use offset>{offset + len(sliced)} for more)"
                if truncated
                else f"\n({len(entries)} entries)"
            )
            output = "\n".join([
                f"<path>{path}</path>",
                "<type>directory</type>",
                "<entries>",
                body + suffix,
                "</entries>",
            ])
            return ToolResult(
                title=str(path),
                output=output,
                metadata={"count": len(entries), "truncated": truncated},
            )

        if self._is_binary(path):
            raise ToolExecutionError(f"Cannot read binary file: {path}")

        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        start = offset - 1
        if start >= len(lines):
            raise ToolExecutionError(f"Offset {offset} out of range ({len(lines)} lines)")

        collected: list[str] = []
        bytes_used = 0
        for idx, line in enumerate(lines[start : start + limit], start=offset):
            clipped = line[:2000] + ("..." if len(line) > 2000 else "")
            rendered = f"{idx}: {clipped}"
            next_bytes = len(rendered.encode("utf-8")) + 1
            if bytes_used + next_bytes > MAX_READ_BYTES:
                break
            collected.append(rendered)
            bytes_used += next_bytes

        last_line = offset + len(collected) - 1
        truncated = last_line < len(lines)
        trailer = (
            f"\n\n(File has more lines. Use offset>{last_line} to continue)"
            if truncated
            else f"\n\n(End of file - total {len(lines)} lines)"
        )

        output = "\n".join([
            f"<path>{path}</path>",
            "<type>file</type>",
            "<content>",
            "\n".join(collected) + trailer,
            "</content>",
        ])
        return ToolResult(
            title=str(path),
            output=output,
            metadata={"truncated": truncated, "lines": len(lines)},
        )

    def _write(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        file_path = args.get("filePath")
        content = args.get("content")
        if not isinstance(file_path, str) or not file_path:
            raise ToolExecutionError("filePath is required")
        if not isinstance(content, str):
            raise ToolExecutionError("content must be a string")

        path = self._resolve_path(ctx, file_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        old = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
        path.write_text(content, encoding="utf-8")

        diff = self._diff(old, content, str(path))
        return ToolResult(
            title=f"Wrote {path}",
            output="Wrote file successfully.",
            metadata={"filepath": str(path), "diff": diff, "exists_before": bool(old)},
        )

    def _edit(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        file_path = args.get("filePath")
        old_string = args.get("oldString")
        new_string = args.get("newString")
        replace_all = bool(args.get("replaceAll", False))

        if not all(isinstance(x, str) for x in [file_path, old_string, new_string]):
            raise ToolExecutionError("filePath, oldString, newString are required strings")
        if old_string == new_string:
            raise ToolExecutionError("No changes to apply: oldString and newString are identical")

        path = self._resolve_path(ctx, file_path)
        if not path.exists() or path.is_dir():
            raise ToolExecutionError(f"File not found: {path}")

        old_text = path.read_text(encoding="utf-8", errors="replace")
        self._validate_edit(old_text, old_string, replace_all)

        new_text = old_text.replace(old_string, new_string) if replace_all else old_text.replace(old_string, new_string, 1)
        path.write_text(new_text, encoding="utf-8")
        diff = self._diff(old_text, new_text, str(path))

        return ToolResult(
            title=str(path),
            output="Edit applied successfully.",
            metadata={"diff": diff},
        )

    def _multiedit(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        file_path = args.get("filePath")
        edits = args.get("edits")
        if not isinstance(file_path, str) or not file_path:
            raise ToolExecutionError("filePath is required")
        if not isinstance(edits, list) or not edits:
            raise ToolExecutionError("edits must be a non-empty list")

        path = self._resolve_path(ctx, file_path)
        original = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
        current = original

        for idx, edit in enumerate(edits, start=1):
            if not isinstance(edit, dict):
                raise ToolExecutionError(f"edit {idx} must be an object")
            old = edit.get("oldString")
            new = edit.get("newString")
            replace_all = bool(edit.get("replaceAll", False))
            if not isinstance(old, str) or not isinstance(new, str):
                raise ToolExecutionError(f"edit {idx} missing oldString/newString")
            if old == new:
                raise ToolExecutionError(f"edit {idx} oldString and newString are identical")

            self._validate_edit(current, old, replace_all)
            current = current.replace(old, new) if replace_all else current.replace(old, new, 1)

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(current, encoding="utf-8")
        diff = self._diff(original, current, str(path))

        return ToolResult(
            title=str(path),
            output=f"Applied {len(edits)} edits successfully.",
            metadata={"diff": diff},
        )

    def _list(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        target = self._resolve_path(ctx, args.get("path"))
        ignore = args.get("ignore")
        ignore_patterns = list(DEFAULT_IGNORE_PATTERNS)
        if isinstance(ignore, list):
            ignore_patterns.extend(str(x) for x in ignore)

        if not target.exists() or not target.is_dir():
            raise ToolExecutionError(f"Not a directory: {target}")

        entries: list[str] = []
        limit = 200
        for root, dirs, files in os.walk(target):
            rel_root = os.path.relpath(root, target)
            rel_root = "" if rel_root == "." else rel_root

            filtered_dirs = []
            for d in dirs:
                rel = f"{rel_root}/{d}".strip("/") + "/"
                if any(fnmatch.fnmatch(rel, pat) or rel.startswith(pat.rstrip("*")) for pat in ignore_patterns):
                    continue
                filtered_dirs.append(d)
            dirs[:] = filtered_dirs

            for d in dirs:
                rel = f"{rel_root}/{d}".strip("/") + "/"
                entries.append(rel)
                if len(entries) >= limit:
                    break
            if len(entries) >= limit:
                break

            for f in files:
                rel = f"{rel_root}/{f}".strip("/")
                if any(fnmatch.fnmatch(rel, pat) for pat in ignore_patterns):
                    continue
                entries.append(rel)
                if len(entries) >= limit:
                    break
            if len(entries) >= limit:
                break

        entries = sorted(entries)
        output = f"{target}/\n" + "\n".join(f"  {x}" for x in entries)
        return ToolResult(
            title=str(target),
            output=output,
            metadata={"count": len(entries), "truncated": len(entries) >= limit},
        )

    def _glob(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        pattern = args.get("pattern")
        if not isinstance(pattern, str) or not pattern:
            raise ToolExecutionError("pattern is required")

        base = self._resolve_path(ctx, args.get("path"))
        if not base.exists() or not base.is_dir():
            raise ToolExecutionError(f"glob base path does not exist: {base}")

        matches = [str(p.resolve()) for p in base.glob(pattern)]
        matches.sort(key=lambda p: Path(p).stat().st_mtime if Path(p).exists() else 0, reverse=True)

        truncated = len(matches) > 500
        shown = matches[:500]
        return ToolResult(
            title=f"Glob {pattern}",
            output="\n".join(shown),
            metadata={"count": len(matches), "truncated": truncated},
        )

    def _grep(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        pattern = args.get("pattern")
        if not isinstance(pattern, str) or not pattern:
            raise ToolExecutionError("pattern is required")

        include = args.get("include")
        base = self._resolve_path(ctx, args.get("path"))
        if not base.exists() or not base.is_dir():
            raise ToolExecutionError(f"grep path does not exist: {base}")

        # Fast path through ripgrep when available.
        if shutil.which("rg"):
            cmd = ["rg", "-n", "--no-heading", pattern, str(base)]
            if isinstance(include, str) and include.strip():
                cmd = ["rg", "-n", "--no-heading", "-g", include, pattern, str(base)]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            out = (proc.stdout or "") + (proc.stderr or "")
            out, truncated = self._truncate_text(out)
            lines = [line for line in out.splitlines() if line.strip()]
            return ToolResult(
                title=f"Grep {pattern}",
                output=out,
                metadata={"matches": len(lines), "truncated": truncated, "exit": proc.returncode},
            )

        try:
            regex = re.compile(pattern)
        except re.error as exc:
            raise ToolExecutionError(f"Invalid regex: {exc}") from exc

        files: list[Path] = []
        if isinstance(include, str) and include.strip():
            files = [p for p in base.glob(include) if p.is_file()]
        else:
            files = [p for p in base.rglob("*") if p.is_file()]

        results: list[str] = []
        for file in files:
            rel = str(file.relative_to(base))
            if any(rel.startswith(pat.rstrip("/")) for pat in DEFAULT_IGNORE_PATTERNS):
                continue
            if self._is_binary(file):
                continue

            try:
                for idx, line in enumerate(file.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
                    if regex.search(line):
                        results.append(f"{file}:{idx}:{line}")
                        if len(results) >= 1000:
                            break
                if len(results) >= 1000:
                    break
            except Exception:
                continue

        output = "\n".join(results)
        output, truncated = self._truncate_text(output)
        return ToolResult(
            title=f"Grep {pattern}",
            output=output,
            metadata={"matches": len(results), "truncated": truncated},
        )

    def _webfetch(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        url = args.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            raise ToolExecutionError("url must start with http:// or https://")

        fmt = str(args.get("format", "markdown"))
        timeout = float(args.get("timeout", 30))

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "opencode-py/0.1",
                "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                ctype = resp.headers.get("content-type", "")
                data = resp.read(5 * 1024 * 1024 + 1)
        except urllib.error.URLError as exc:
            raise ToolExecutionError(f"Failed to fetch URL: {exc}") from exc

        if len(data) > 5 * 1024 * 1024:
            raise ToolExecutionError("Response too large (exceeds 5MB)")

        mime = ctype.split(";")[0].strip().lower()
        if mime.startswith("image/") and mime not in {"image/svg+xml", "image/vnd.fastbidsheet"}:
            return ToolResult(title=f"{url} ({ctype})", output="Image fetched successfully", metadata={"mime": mime})

        text = data.decode("utf-8", errors="replace")
        if fmt == "html":
            out = text
        elif "html" in ctype:
            parser = _HTMLTextExtractor()
            parser.feed(text)
            out = parser.text()
        else:
            out = text

        out, truncated = self._truncate_text(out)
        return ToolResult(
            title=f"{url} ({ctype})",
            output=out,
            metadata={"truncated": truncated},
        )

    @staticmethod
    def _exa_call(name: str, arguments: dict[str, Any]) -> str:
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments,
            },
        }
        req = urllib.request.Request(
            "https://mcp.exa.ai/mcp",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "accept": "application/json, text/event-stream",
                "content-type": "application/json",
                "user-agent": "opencode-py/0.1",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")

        for line in raw.splitlines():
            if not line.startswith("data: "):
                continue
            payload = json.loads(line[6:])
            result = payload.get("result", {})
            content = result.get("content", [])
            if content and isinstance(content, list):
                first = content[0]
                if isinstance(first, dict) and "text" in first:
                    return str(first["text"])
        return "No results returned."

    def _websearch(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ToolExecutionError("query is required")

        payload = {
            "query": query,
            "type": str(args.get("type", "auto")),
            "numResults": int(args.get("numResults", 8)),
            "livecrawl": str(args.get("livecrawl", "fallback")),
        }
        if "contextMaxCharacters" in args:
            payload["contextMaxCharacters"] = int(args["contextMaxCharacters"])

        try:
            output = self._exa_call("web_search_exa", payload)
        except Exception as exc:  # noqa: BLE001
            raise ToolExecutionError(f"websearch failed: {exc}") from exc

        return ToolResult(title=f"Web search: {query}", output=output)

    def _codesearch(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ToolExecutionError("query is required")

        payload = {
            "query": query,
            "tokensNum": int(args.get("tokensNum", 5000)),
        }

        try:
            output = self._exa_call("get_code_context_exa", payload)
        except Exception as exc:  # noqa: BLE001
            raise ToolExecutionError(f"codesearch failed: {exc}") from exc

        return ToolResult(title=f"Code search: {query}", output=output)

    def _skill_discovery(self, ctx: ToolContext) -> dict[str, dict[str, Any]]:
        roots = [
            ctx.workspace_root / ".opencode" / "skill",
            ctx.workspace_root / ".opencode" / "skills",
            ctx.workspace_root / ".claude" / "skills",
            ctx.workspace_root / ".agents" / "skills",
            Path.home() / ".claude" / "skills",
            Path.home() / ".agents" / "skills",
        ]
        skills: dict[str, dict[str, Any]] = {}

        for root in roots:
            if not root.exists():
                continue
            for skill_file in root.rglob("SKILL.md"):
                text = skill_file.read_text(encoding="utf-8", errors="replace")
                name = skill_file.parent.name
                description = ""
                body = text
                if text.startswith("---\n"):
                    end = text.find("\n---\n", 4)
                    if end != -1:
                        raw = text[4:end]
                        body = text[end + 5 :]
                        for line in raw.splitlines():
                            if ":" not in line:
                                continue
                            k, v = line.split(":", 1)
                            key = k.strip().lower()
                            value = v.strip().strip('"').strip("'")
                            if key == "name" and value:
                                name = value
                            if key == "description":
                                description = value

                skills[name] = {
                    "name": name,
                    "description": description,
                    "path": str(skill_file),
                    "content": body.strip(),
                }
        return skills

    def _skill(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        name = args.get("name")
        if not isinstance(name, str) or not name:
            raise ToolExecutionError("name is required")

        skills = self._skill_discovery(ctx)
        if name not in skills:
            available = ", ".join(sorted(skills)) or "none"
            raise ToolExecutionError(f"Skill '{name}' not found. Available skills: {available}")

        skill = skills[name]
        out = "\n".join(
            [
                f"<skill_content name=\"{skill['name']}\">",
                skill["content"],
                f"\nBase directory: {Path(skill['path']).parent}",
                "</skill_content>",
            ],
        )
        return ToolResult(
            title=f"Loaded skill: {name}",
            output=out,
            metadata={"name": name, "path": skill["path"]},
        )

    def _task(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        description = args.get("description")
        prompt = args.get("prompt")
        subagent = args.get("subagent_type")
        raw_model = args.get("model")
        raw_max_steps = args.get("max_steps", DEFAULT_SUBAGENT_MAX_STEPS)

        if not isinstance(description, str) or not isinstance(prompt, str) or not isinstance(subagent, str):
            raise ToolExecutionError("description, prompt and subagent_type are required")
        if raw_model is not None and not isinstance(raw_model, str):
            raise ToolExecutionError("model must be a string when provided")
        if not isinstance(raw_max_steps, int):
            raise ToolExecutionError("max_steps must be an integer when provided")

        if ctx.runtime is None:
            return ToolResult(
                title=description,
                output="task tool is available, but no runtime is attached to execute subagents.",
                metadata={"subagent_type": subagent},
            )

        if ctx.task_depth >= 2:
            raise ToolExecutionError("Maximum nested task depth reached")

        max_steps = max(1, min(raw_max_steps, MAX_SUBAGENT_MAX_STEPS))
        subagent_model = (
            raw_model.strip()
            if isinstance(raw_model, str) and raw_model.strip()
            else os.getenv("COMPLIANCE_SUBAGENT_MODEL")
            or os.getenv("SUBAGENT_MODEL")
            or None
        )
        task_prompt = (
            "<subagent_budget>\n"
            f"You have a strict budget of {max_steps} total steps for this task.\n"
            "- Work narrowly and avoid exploratory detours.\n"
            "- Reuse existing workspace artifacts when possible.\n"
            "- Return the requested final JSON before the step budget is exhausted.\n"
            "</subagent_budget>\n\n"
            f"{prompt}"
        )
        result = ctx.runtime.run(
            task_prompt,
            agent=subagent,
            model=subagent_model,
            task_depth=ctx.task_depth + 1,
            max_steps=max_steps,
        )
        output = "\n".join(
            [
                f"task_id: task-{int(time.time() * 1000)}",
                "",
                "<task_result>",
                result.text,
                "</task_result>",
            ],
        )

        return ToolResult(
            title=description,
            output=output,
            metadata={
                "subagent_type": subagent,
                "model": subagent_model,
                "steps": result.steps,
                "max_steps": max_steps,
            },
        )

    def _todo_file(self, ctx: ToolContext) -> Path:
        return ctx.state_dir / "todos.json"

    def _todoread(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        file = self._todo_file(ctx)
        todos: list[dict[str, Any]] = []
        if file.exists():
            try:
                parsed = json.loads(file.read_text(encoding="utf-8"))
                if isinstance(parsed, list):
                    todos = parsed
            except Exception:
                todos = []

        pending = sum(1 for t in todos if str(t.get("status", "")) != "completed")
        return ToolResult(
            title=f"{pending} todos",
            output=json.dumps(todos, indent=2),
            metadata={"todos": todos},
        )

    def _todowrite(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        todos = args.get("todos")
        if not isinstance(todos, list):
            raise ToolExecutionError("todos must be an array")

        file = self._todo_file(ctx)
        file.write_text(json.dumps(todos, indent=2), encoding="utf-8")
        pending = sum(1 for t in todos if str((t or {}).get("status", "")) != "completed")
        return ToolResult(
            title=f"{pending} todos",
            output=json.dumps(todos, indent=2),
            metadata={"todos": todos},
        )

    def _apply_update_blocks(self, original: str, lines: list[str]) -> str:
        text = original.replace("\r\n", "\n")
        blocks: list[list[str]] = []
        current: list[str] = []

        for line in lines:
            if line.startswith("@@"):
                if current:
                    blocks.append(current)
                    current = []
                continue
            if not line:
                current.append(" " )
                continue
            if line[0] not in {" ", "+", "-"}:
                raise ToolExecutionError(f"Invalid update line: {line}")
            current.append(line)
        if current:
            blocks.append(current)

        if not blocks and lines:
            blocks = [lines]

        for block in blocks:
            old_block = "\n".join(line[1:] for line in block if line and line[0] in {" ", "-"})
            new_block = "\n".join(line[1:] for line in block if line and line[0] in {" ", "+"})
            if old_block not in text:
                raise ToolExecutionError("apply_patch verification failed: context not found during update")
            text = text.replace(old_block, new_block, 1)

        return text

    def _apply_patch(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        patch = args.get("patchText")
        if not isinstance(patch, str) or not patch.strip():
            raise ToolExecutionError("patchText is required")

        lines = patch.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if not lines or lines[0].strip() != "*** Begin Patch":
            raise ToolExecutionError("apply_patch verification failed: missing *** Begin Patch")

        i = 1
        changed: list[str] = []
        while i < len(lines):
            line = lines[i]
            if line.strip() == "*** End Patch":
                break

            if line.startswith("*** Add File: "):
                rel = line[len("*** Add File: ") :].strip()
                target = self._resolve_path(ctx, rel)
                i += 1
                content_lines: list[str] = []
                while i < len(lines) and not lines[i].startswith("*** "):
                    current = lines[i]
                    if current and not current.startswith("+"):
                        raise ToolExecutionError("Add File expects lines prefixed with '+'")
                    content_lines.append(current[1:] if current.startswith("+") else "")
                    i += 1
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("\n".join(content_lines), encoding="utf-8")
                changed.append(f"A {target}")
                continue

            if line.startswith("*** Delete File: "):
                rel = line[len("*** Delete File: ") :].strip()
                target = self._resolve_path(ctx, rel)
                if not target.exists():
                    raise ToolExecutionError(f"Cannot delete missing file: {target}")
                target.unlink()
                changed.append(f"D {target}")
                i += 1
                continue

            if line.startswith("*** Update File: "):
                rel = line[len("*** Update File: ") :].strip()
                source = self._resolve_path(ctx, rel)
                if not source.exists() or source.is_dir():
                    raise ToolExecutionError(f"Cannot update file: {source}")

                i += 1
                move_to: Path | None = None
                if i < len(lines) and lines[i].startswith("*** Move to: "):
                    move_to = self._resolve_path(ctx, lines[i][len("*** Move to: ") :].strip())
                    i += 1

                block: list[str] = []
                while i < len(lines) and not lines[i].startswith("*** "):
                    block.append(lines[i])
                    i += 1

                old = source.read_text(encoding="utf-8", errors="replace")
                new = self._apply_update_blocks(old, block)

                destination = move_to or source
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(new, encoding="utf-8")
                if move_to and source != destination:
                    source.unlink()

                changed.append(f"M {destination}")
                continue

            if not line.strip():
                i += 1
                continue

            raise ToolExecutionError(f"apply_patch verification failed: unknown directive: {line}")

        if not changed:
            raise ToolExecutionError("patch rejected: empty patch")

        return ToolResult(
            title="apply_patch",
            output="Success. Updated the following files:\n" + "\n".join(changed),
            metadata={"files": changed},
        )

    def _plan_enter(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        approved = True
        if ctx.interactive:
            raw = input("Switch to plan agent? [Y/n]: ").strip().lower()
            approved = raw in {"", "y", "yes"}

        if not approved:
            return ToolResult(title="Plan mode", output="User declined to switch to plan mode.", metadata={"approved": False})

        return ToolResult(
            title="Switching to plan agent",
            output="User confirmed to switch to plan mode.",
            metadata={"approved": True, "agent": "plan"},
        )

    def _plan_exit(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        approved = True
        if ctx.interactive:
            raw = input("Switch to build agent and start implementation? [Y/n]: ").strip().lower()
            approved = raw in {"", "y", "yes"}

        if not approved:
            return ToolResult(
                title="Plan mode",
                output="User chose to continue refining the plan.",
                metadata={"approved": False},
            )

        return ToolResult(
            title="Switching to build agent",
            output="User approved switching to build agent.",
            metadata={"approved": True, "agent": "build"},
        )

    def _lsp(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        return ToolResult(
            title="LSP",
            output="LSP tool is currently a stub in this Python runtime.",
            metadata={"implemented": False},
        )

    def _batch(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        calls = args.get("tool_calls")
        if not isinstance(calls, list) or not calls:
            raise ToolExecutionError("tool_calls must be a non-empty array")

        calls = calls[:25]

        def run_one(item: dict[str, Any]) -> dict[str, Any]:
            tool = item.get("tool")
            parameters = item.get("parameters", {})
            if not isinstance(tool, str):
                return {"tool": str(tool), "success": False, "error": "tool must be string"}
            if tool == "batch":
                return {"tool": tool, "success": False, "error": "batch cannot call batch"}
            try:
                result = self.execute(tool, parameters if isinstance(parameters, dict) else {}, replace(ctx))
                return {
                    "tool": tool,
                    "success": True,
                    "title": result.title,
                    "output": result.output,
                    "metadata": result.metadata,
                }
            except Exception as exc:  # noqa: BLE001
                return {"tool": tool, "success": False, "error": str(exc)}

        results: list[dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(calls))) as ex:
            futures = [ex.submit(run_one, c if isinstance(c, dict) else {}) for c in calls]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        successful = sum(1 for r in results if r.get("success"))
        failed = len(results) - successful
        return ToolResult(
            title=f"Batch execution ({successful}/{len(results)} successful)",
            output=(
                f"Executed {successful}/{len(results)} tools successfully. {failed} failed."
                if failed
                else f"All {successful} tools executed successfully."
            ),
            metadata={"results": results, "successful": successful, "failed": failed},
        )

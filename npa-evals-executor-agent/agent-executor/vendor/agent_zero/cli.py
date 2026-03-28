from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    from .runtime import AgentRuntime
except ImportError:
    from runtime import AgentRuntime


def _make_runtime(args: argparse.Namespace) -> AgentRuntime:
    api_key = getattr(args, "chat_api_key", None) or getattr(args, "api_key", None)
    api_base = getattr(args, "chat_api_base", None) or getattr(args, "api_base", None)
    return AgentRuntime(
        repo_root=Path(args.repo_root).resolve() if args.repo_root else None,
        workspace_root=Path(args.workspace_root).resolve() if args.workspace_root else None,
        cwd=Path(args.cwd).resolve() if args.cwd else None,
        interactive=not args.non_interactive,
        api_key=api_key,
        api_base=api_base,
        request_timeout=getattr(args, "request_timeout", None),
    )


def cmd_agents(args: argparse.Namespace) -> int:
    runtime = _make_runtime(args)
    for agent in runtime.list_agents(include_hidden=args.hidden):
        print(f"{agent.name} ({agent.mode})")
        if agent.description:
            print(f"  {agent.description}")
    return 0


def cmd_tools(args: argparse.Namespace) -> int:
    runtime = _make_runtime(args)
    names = runtime.list_tools(args.agent)
    for name in names:
        print(name)
    return 0


def cmd_tool(args: argparse.Namespace) -> int:
    runtime = _make_runtime(args)
    try:
        payload = json.loads(args.args) if args.args else {}
        if not isinstance(payload, dict):
            raise ValueError("--args must decode to a JSON object")
    except Exception as exc:  # noqa: BLE001
        print(f"Invalid --args JSON: {exc}", file=sys.stderr)
        return 2

    try:
        result = runtime.run_tool(args.tool_name, payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Tool failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(
            json.dumps(
                {
                    "title": result.title,
                    "output": result.output,
                    "metadata": result.metadata,
                },
                indent=2,
            ),
        )
        return 0

    print(f"[{result.title}]")
    print(result.output)
    if args.metadata:
        print("\n<metadata>")
        print(json.dumps(result.metadata, indent=2))
        print("</metadata>")
    return 0


def cmd_chat(args: argparse.Namespace) -> int:
    runtime = _make_runtime(args)

    def shorten(value: str, limit: int = 180) -> str:
        text = value.replace("\n", "\\n")
        if len(text) <= limit:
            return text
        return text[: limit - 3] + "..."

    def on_event(event: dict[str, object]) -> None:
        if not args.verbose_tools or args.json:
            return

        ts = datetime.now().strftime("%H:%M:%S")
        kind = str(event.get("type", "event"))

        if kind == "run.start":
            timeout = event.get("request_timeout")
            timeout_text = "none" if timeout in {None, 0, 0.0} else f"{timeout}s"
            print(
                f"[{ts}] run.start agent={event.get('agent')} model={event.get('model')} max_steps={event.get('max_steps')} timeout={timeout_text}",
                flush=True,
            )
            return
        if kind == "step.start":
            print(f"[{ts}] step {event.get('step')} start", flush=True)
            return
        if kind == "step.response":
            preview = shorten(str(event.get("content_preview", "")))
            print(
                f"[{ts}] step {event.get('step')} response finish={event.get('finish_reason')} tools={event.get('has_tool_calls')} preview={preview}",
                flush=True,
            )
            return
        if kind == "step.tool_calls":
            print(
                f"[{ts}] step {event.get('step')} tool_calls count={event.get('count')} tools={event.get('tools')}",
                flush=True,
            )
            return
        if kind in {"tool.start", "tool.end", "tool.error", "tool.inferred"}:
            name = event.get("name")
            source = event.get("source")
            if kind == "tool.start":
                args_preview = shorten(json.dumps(event.get("args", {}), ensure_ascii=False))
                print(f"[{ts}] tool.start {name} source={source} args={args_preview}", flush=True)
                return
            if kind == "tool.end":
                out_preview = shorten(str(event.get("output_preview", "")))
                print(f"[{ts}] tool.end {name} source={source} output={out_preview}", flush=True)
                return
            if kind == "tool.error":
                print(f"[{ts}] tool.error {name} source={source} error={event.get('error')}", flush=True)
                return
            if kind == "tool.inferred":
                args_preview = shorten(json.dumps(event.get("args", {}), ensure_ascii=False))
                print(f"[{ts}] tool.inferred {name} args={args_preview}", flush=True)
                return
        if kind == "run.finish":
            print(
                f"[{ts}] run.finish reason={event.get('reason')} step={event.get('step')} tool_events={event.get('tool_events')}",
                flush=True,
            )
            return

        print(f"[{ts}] {kind}: {event}", flush=True)

    try:
        result = runtime.run(
            user_prompt=args.prompt,
            agent=args.agent,
            model=args.model,
            max_steps=args.max_steps,
            on_event=on_event,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Chat failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(
            json.dumps(
                {
                    "text": result.text,
                    "steps": result.steps,
                    "tool_events": [
                        {
                            "name": e.name,
                            "arguments": e.arguments,
                            "result": {
                                "title": e.result.title,
                                "output": e.result.output,
                                "metadata": e.result.metadata,
                            },
                        }
                        for e in result.tool_events
                    ],
                },
                indent=2,
            ),
        )
        return 0

    if args.verbose_tools and result.tool_events:
        print("# Tool Calls")
        for event in result.tool_events:
            print(f"- {event.name}({json.dumps(event.arguments, ensure_ascii=False)})")

    print(result.text)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Python OpenCode-style agent runtime")

    p.add_argument("--repo-root", help="Repo root path (auto-detected if omitted)")
    p.add_argument("--workspace-root", help="Workspace/project root (default: cwd)")
    p.add_argument("--cwd", help="Working directory for tools (default: cwd)")
    p.add_argument("--api-key", help="OpenAI-compatible API key")
    p.add_argument("--api-base", help="OpenAI-compatible base URL")
    p.add_argument("--non-interactive", action="store_true", help="Disable interactive prompts")

    sub = p.add_subparsers(dest="cmd", required=True)

    p_agents = sub.add_parser("agents", help="List agents")
    p_agents.add_argument("--hidden", action="store_true", help="Include hidden agents")
    p_agents.set_defaults(fn=cmd_agents)

    p_tools = sub.add_parser("tools", help="List tools")
    p_tools.add_argument("--agent", help="Filter tools by agent tool policy")
    p_tools.set_defaults(fn=cmd_tools)

    p_tool = sub.add_parser("tool", help="Run a single tool directly")
    p_tool.add_argument("tool_name", help="Tool name")
    p_tool.add_argument("--args", default="{}", help="JSON args object")
    p_tool.add_argument("--json", action="store_true", help="Emit JSON output")
    p_tool.add_argument("--metadata", action="store_true", help="Print metadata in text mode")
    p_tool.set_defaults(fn=cmd_tool)

    p_chat = sub.add_parser("chat", help="Run agent chat loop")
    p_chat.add_argument("prompt", help="User prompt")
    p_chat.add_argument("--agent", default="build", help="Agent name")
    p_chat.add_argument(
        "--model",
        default=None,
        help="Model id (defaults to OPENAI_MODEL/GROQ_MODEL, then gpt-4o-mini)",
    )
    p_chat.add_argument("--api-key", dest="chat_api_key", help="OpenAI-compatible API key override")
    p_chat.add_argument("--api-base", dest="chat_api_base", help="OpenAI-compatible base URL override")
    p_chat.add_argument("--max-steps", type=int, default=16, help="Maximum loop steps")
    p_chat.add_argument(
        "--request-timeout",
        type=float,
        default=None,
        help="Per-request timeout in seconds (default: OPENAI_TIMEOUT or 120; use 0 to disable)",
    )
    p_chat.add_argument("--verbose-tools", action="store_true", help="Print tool-call trace")
    p_chat.add_argument("--json", action="store_true", help="Emit JSON output")
    p_chat.set_defaults(fn=cmd_chat)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.fn(args))
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

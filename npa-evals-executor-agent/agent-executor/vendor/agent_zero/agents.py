from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    from .prompts import load_agent_prompt, load_session_prompt
except ImportError:
    from prompts import load_agent_prompt, load_session_prompt


@dataclass
class AgentSpec:
    name: str
    mode: str = "primary"
    description: str = ""
    prompt: str = ""
    hidden: bool = False
    tools_allow: set[str] | None = None
    tools_deny: set[str] = field(default_factory=set)

    def allows_tool(self, tool_name: str) -> bool:
        if self.tools_allow is not None and tool_name not in self.tools_allow:
            return False
        return tool_name not in self.tools_deny


READ_ONLY_TOOLS = {
    "invalid",
    "question",
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
    "codesearch",
    "skill",
    "task",
    "todoread",
    "plan_exit",
    "lsp",
}

EXPLORE_TOOLS = {
    "invalid",
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
    "codesearch",
}

WORKSPACE_ANALYST_TOOLS = {
    "invalid",
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
    "task",
    "write",
    "edit",
    "multiedit",
    "batch",
    "todowrite",
    "todoread",
}

COMPLIANCE_FACTOR_ANALYST_TOOLS = {
    "invalid",
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
}


class AgentManager:
    def __init__(self, repo_root: Path, workspace_root: Path):
        self.repo_root = repo_root
        self.workspace_root = workspace_root
        self._agents = self._load_builtins()
        self._agents.update(self._load_custom_agents())

    def _load_builtins(self) -> dict[str, AgentSpec]:
        return {
            "build": AgentSpec(
                name="build",
                mode="primary",
                description="Default full-access agent.",
            ),
            "plan": AgentSpec(
                name="plan",
                mode="primary",
                description="Read-only planning agent.",
                prompt=load_session_prompt(self.repo_root, "plan"),
                tools_allow=READ_ONLY_TOOLS,
                hidden=False,
            ),
            "general": AgentSpec(
                name="general",
                mode="subagent",
                description="General-purpose research and multi-step subagent.",
                tools_deny={"todowrite", "todoread"},
            ),
            "explore": AgentSpec(
                name="explore",
                mode="subagent",
                description="Codebase exploration specialist.",
                prompt=load_agent_prompt(self.repo_root, "explore"),
                tools_allow=EXPLORE_TOOLS,
            ),
            "compliance_factor_analyst": AgentSpec(
                name="compliance_factor_analyst",
                mode="subagent",
                description="Focused compliance evidence researcher for one assigned factor at a time.",
                prompt=load_agent_prompt(self.repo_root, "compliance_factor_analyst"),
                tools_allow=COMPLIANCE_FACTOR_ANALYST_TOOLS,
            ),
            "workspace_analyst": AgentSpec(
                name="workspace_analyst",
                mode="primary",
                description="Restricted workspace agent for spreadsheet and file analysis.",
                prompt=load_agent_prompt(self.repo_root, "workspace_analyst"),
                tools_allow=WORKSPACE_ANALYST_TOOLS,
            ),
            "compaction": AgentSpec(
                name="compaction",
                mode="primary",
                hidden=True,
                prompt=load_agent_prompt(self.repo_root, "compaction"),
                tools_allow={"invalid"},
            ),
            "title": AgentSpec(
                name="title",
                mode="primary",
                hidden=True,
                prompt=load_agent_prompt(self.repo_root, "title"),
                tools_allow={"invalid"},
            ),
            "summary": AgentSpec(
                name="summary",
                mode="primary",
                hidden=True,
                prompt=load_agent_prompt(self.repo_root, "summary"),
                tools_allow={"invalid"},
            ),
        }

    def _load_custom_agents(self) -> dict[str, AgentSpec]:
        out: dict[str, AgentSpec] = {}
        for rel in [".opencode/agent", ".opencode/agents", "agent", "agents"]:
            base = self.workspace_root / rel
            if not base.exists():
                continue
            for md in base.rglob("*.md"):
                parsed = self._parse_markdown(md)
                if not parsed:
                    continue
                meta, body = parsed
                name = md.stem
                mode = str(meta.get("mode", "all"))
                if mode not in {"all", "primary", "subagent"}:
                    mode = "all"
                description = str(meta.get("description", ""))
                hidden = str(meta.get("hidden", "false")).lower() == "true"
                tools = meta.get("tools")
                tools_allow = None
                tools_deny: set[str] = set()

                if isinstance(tools, dict):
                    deny = {k for k, v in tools.items() if str(v).lower() == "false"}
                    tools_deny |= deny

                out[name] = AgentSpec(
                    name=name,
                    mode=mode,
                    description=description,
                    prompt=body.strip(),
                    hidden=hidden,
                    tools_allow=tools_allow,
                    tools_deny=tools_deny,
                )
        return out

    @staticmethod
    def _parse_markdown(path: Path) -> tuple[dict[str, Any], str] | None:
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            return {}, text
        end = text.find("\n---\n", 4)
        if end == -1:
            return {}, text

        raw = text[4:end].strip()
        body = text[end + 5 :]
        meta: dict[str, Any] = {}

        for line in raw.splitlines():
            if not line.strip() or line.strip().startswith("#"):
                continue
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip('"').strip("'")
        return meta, body

    def list(self, include_hidden: bool = False) -> list[AgentSpec]:
        agents = list(self._agents.values())
        if include_hidden:
            return sorted(agents, key=lambda a: a.name)
        return sorted([a for a in agents if not a.hidden], key=lambda a: a.name)

    def get(self, name: str) -> AgentSpec:
        if name not in self._agents:
            raise KeyError(f"Agent not found: {name}")
        return self._agents[name]

    def default(self) -> AgentSpec:
        if "build" in self._agents:
            return self._agents["build"]
        visible = self.list(include_hidden=False)
        if not visible:
            raise RuntimeError("No visible agents available")
        return visible[0]

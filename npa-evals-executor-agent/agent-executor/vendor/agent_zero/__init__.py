"""Python starter runtime for OpenCode-style agents and tools."""

try:
    from .agents import AgentManager, AgentSpec
    from .runtime import AgentRuntime, RunResult
    from .tools import ToolRegistry, ToolSpec, ToolResult, ToolContext
except ImportError:
    from agents import AgentManager, AgentSpec
    from runtime import AgentRuntime, RunResult
    from tools import ToolRegistry, ToolSpec, ToolResult, ToolContext

__all__ = [
    "AgentManager",
    "AgentRuntime",
    "AgentSpec",
    "RunResult",
    "ToolRegistry",
    "ToolSpec",
    "ToolResult",
    "ToolContext",
]

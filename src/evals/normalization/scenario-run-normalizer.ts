import type { NormalizedEvaluationRecord } from "../contracts/normalized-evaluation-record.js";
import type { ScenarioRunResult } from "../../runtime/runner/scenario-runner.js";
import { ToolChainAgentAdapter } from "./tool-chain-agent-adapter.js";
import { WorkspaceAgentAdapter } from "./workspace-agent-adapter.js";

export class ScenarioRunNormalizer {
  constructor(
    private readonly toolChainAdapter = new ToolChainAgentAdapter(),
    private readonly workspaceAdapter = new WorkspaceAgentAdapter()
  ) {}

  normalize(runResult: ScenarioRunResult): NormalizedEvaluationRecord[] {
    return runResult.executions.map((execution) =>
      runResult.scenario.agentFamily === "tool_chain"
        ? this.toolChainAdapter.normalize(runResult, execution)
        : this.workspaceAdapter.normalize(runResult, execution)
    );
  }
}

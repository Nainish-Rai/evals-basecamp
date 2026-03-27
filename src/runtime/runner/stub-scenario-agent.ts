import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { MaterializedCaseEnvironment } from "../materialization/case-environment-materializer.js";
import type { BenchmarkTrace } from "../tracing/langfuse-tracer.js";
import type { ScenarioExecutionPlan } from "./feedback-replay-engine.js";

export type ScenarioAgentRunRequest = {
  scenario: Scenario;
  environment: MaterializedCaseEnvironment;
  executionPlan: ScenarioExecutionPlan;
  trace: BenchmarkTrace;
};

export type ScenarioAgentRunResult = {
  summary: string;
  outputArtifacts: string[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
  vendorTraceId?: string | null;
};

export type ScenarioAgent = {
  run(request: ScenarioAgentRunRequest): Promise<ScenarioAgentRunResult>;
};

export class StubScenarioAgent implements ScenarioAgent {
  run(request: ScenarioAgentRunRequest): Promise<ScenarioAgentRunResult> {
    const requiredFindings =
      request.environment.surfacedDrift.expectedOutcomeCriteria.requiredFindings;
    const feedbackCount = request.executionPlan.feedbackTurns.length;
    const registryEntryCount = request.environment.registryEntries.length;

    return Promise.resolve({
      summary: [
        `mode=${request.executionPlan.mode}`,
        `requiredFindings=${requiredFindings.join(",")}`,
        `feedbackCount=${feedbackCount}`,
        `workspace=${request.environment.workspacePath}`
      ].join(" | "),
      outputArtifacts: request.environment.registryEntries.map((entry) => entry.path),
      tokenUsage: {
        inputTokens: 200 + registryEntryCount,
        outputTokens: 60 + feedbackCount * 10,
        totalTokens: 260 + registryEntryCount + feedbackCount * 10
      }
    });
  }
}

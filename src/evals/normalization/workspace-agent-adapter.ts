import type { NormalizedEvaluationRecord } from "../contracts/normalized-evaluation-record.js";
import type {
  ScenarioExecutionResult,
  ScenarioRunResult
} from "../../runtime/runner/scenario-runner.js";
import { NormalizedRecordBuilder } from "./normalized-record-builder.js";

export class WorkspaceAgentAdapter {
  constructor(private readonly builder = new NormalizedRecordBuilder()) {}

  normalize(
    runResult: ScenarioRunResult,
    execution: ScenarioExecutionResult
  ): NormalizedEvaluationRecord {
    return this.builder.build({
      runResult,
      execution,
      overrides: {
        finalResponse: execution.agentResult.summary,
        memoryImpact: runResult.scenario.memoryEvaluationSpec?.expectedMemoryImpact ?? null,
        memoryFailureTypes: classifyWorkspaceMemoryFailureTypes(runResult, execution),
        graphPath: [
          ...new Set([
            ...runResult.scenario.trajectoryHints.expectedNodes,
            ...runResult.scenario.driftEvaluationSpec.trajectory.requiredSteps
          ])
        ],
        latencyMs: 0,
        contextMetrics: {
          contextWindowSizeTokens: 128_000,
          promptTokens:
            runResult.scenario.contextEvaluationSpec.systemPromptProfile.fixedTokenOverhead +
            runResult.scenario.contextEvaluationSpec.systemPromptProfile.dynamicTokenOverhead +
            runResult.scenario.contextEvaluationSpec.toolSurfaceProfile.toolDefinitionTokenOverhead,
          retrievedContextTokens: 0,
          relevantContextTokens: 0,
          unusedContextTokens: 0,
          workspaceArtifactTokens:
            runResult.environment.registryEntries.filter((entry) =>
              entry.path.startsWith(runResult.environment.workspacePath)
            ).length * 15,
          subagentCommunicationTokens: 0
        },
        tokenUsage: {
          ...execution.agentResult.tokenUsage,
          cachedInputTokens: 0
        }
      }
    });
  }
}

function classifyWorkspaceMemoryFailureTypes(
  runResult: ScenarioRunResult,
  execution: ScenarioExecutionResult
): Array<
  | "irrelevant_retrieval"
  | "missed_needed_retrieval"
  | "missed_needed_write"
  | "wasteful_save"
  | "harmful_memory_activation"
  | "stale_memory"
  | "negative_transfer"
> {
  const memorySpec = runResult.scenario.memoryEvaluationSpec;

  if (!memorySpec) {
    return [];
  }

  const failureTypes = new Set<
    | "irrelevant_retrieval"
    | "missed_needed_retrieval"
    | "missed_needed_write"
    | "wasteful_save"
    | "harmful_memory_activation"
    | "stale_memory"
    | "negative_transfer"
  >();

  const turnId =
    execution.mode === "initial"
      ? "turn-1"
      : runResult.scenario.feedbackTurns.find((feedbackTurn) =>
          execution.feedbackIds.includes(feedbackTurn.feedbackId)
        )?.turnId ?? "turn-feedback-rerun";
  const expectedRetrieveIds = memorySpec.memoryCheckpoints
    .filter((checkpoint) => checkpoint.turnId === turnId && checkpoint.expectedAction === "retrieve")
    .flatMap((checkpoint) => checkpoint.relatedOpportunityIds);
  const expectedWriteIds = memorySpec.memoryOpportunities
    .filter((opportunity) => opportunity.worthKeeping && opportunity.relatedTurnIds.includes(turnId))
    .map((opportunity) => opportunity.opportunityId);

  if (expectedWriteIds.length > 0) {
    failureTypes.add("missed_needed_write");
  }

  if (expectedRetrieveIds.length > 0) {
    failureTypes.add("missed_needed_retrieval");
  }

  return [...failureTypes];
}

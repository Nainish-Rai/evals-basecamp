import { z } from "zod";

import type { NormalizedEvaluationRecord } from "../contracts/normalized-evaluation-record.js";
import type {
  ScenarioExecutionResult,
  ScenarioRunResult
} from "../../runtime/runner/scenario-runner.js";
import { NormalizedRecordBuilder } from "./normalized-record-builder.js";

const workspaceAgentMetadataSchema = z.object({
  graphPath: z.array(z.string()).default([]),
  groundedEvidenceRefs: z.array(z.string()).default([]),
  retrievalEvents: z.array(
    z.object({
      retrievalId: z.string(),
      sourceId: z.string(),
      query: z.string(),
      latencyMs: z.number(),
      candidateCount: z.number(),
      selectedCount: z.number(),
      retrievedTokenCount: z.number(),
      relevantTokenCount: z.number(),
      selectedArtifactRefs: z.array(z.string()).default([]),
      relevantArtifactRefs: z.array(z.string()).default([]),
      usedArtifactRefs: z.array(z.string()).default([])
    })
  ).default([]),
  subagentEvents: z.array(
    z.object({
      subagentId: z.string(),
      model: z.string(),
      modelTier: z.enum(["small", "medium", "large"]),
      taskSummary: z.string(),
      status: z.enum(["completed", "failed", "cancelled"])
    })
  ).default([]),
  memoryCandidatesObserved: z.array(
    z.object({
      candidateId: z.string(),
      summary: z.string()
    })
  ).default([]),
  memoryReads: z.array(
    z.object({
      candidateId: z.string(),
      summary: z.string(),
      source: z.enum(["trace_tool_file", "user", "pattern"]),
      scope: z.enum(["step", "case", "cross_case"]),
      neededNow: z.boolean(),
      usedInDecision: z.boolean(),
      impact: z.enum(["positive", "neutral", "negative"])
    })
  ).default([]),
  memoryWrites: z.array(
    z.object({
      candidateId: z.string(),
      summary: z.string(),
      source: z.enum(["trace_tool_file", "user", "pattern"]),
      scope: z.enum(["step", "case", "cross_case"]),
      rationale: z.string()
    })
  ).default([]),
  memoryWritesSkipped: z.array(
    z.object({
      candidateId: z.string(),
      summary: z.string(),
      source: z.enum(["trace_tool_file", "user", "pattern"]),
      scope: z.enum(["step", "case", "cross_case"]),
      rationale: z.string()
    })
  ).default([]),
  contextMetrics: z.object({
    contextWindowSizeTokens: z.number(),
    promptTokens: z.number(),
    retrievedContextTokens: z.number(),
    relevantContextTokens: z.number(),
    unusedContextTokens: z.number(),
    workspaceArtifactTokens: z.number(),
    subagentCommunicationTokens: z.number()
  }).optional(),
  latencyMs: z.number().optional()
});

export class WorkspaceAgentAdapter {
  constructor(private readonly builder = new NormalizedRecordBuilder()) {}

  normalize(
    runResult: ScenarioRunResult,
    execution: ScenarioExecutionResult
  ): NormalizedEvaluationRecord {
    const metadata = workspaceAgentMetadataSchema.parse(execution.agentResult.metadata ?? {});

    return this.builder.build({
      runResult,
      execution,
      overrides: {
        finalResponse: execution.agentResult.summary,
        groundedEvidenceRefs:
          metadata.groundedEvidenceRefs.length > 0
            ? metadata.groundedEvidenceRefs
            : runResult.scenario.expectedOutcomes.flatMap(
                (expectedOutcome) => expectedOutcome.requiredEvidenceRefs
              ),
        retrievalEvents: metadata.retrievalEvents,
        subagentEvents: metadata.subagentEvents,
        memoryCandidatesObserved: metadata.memoryCandidatesObserved,
        memoryReads: metadata.memoryReads,
        memoryWrites: metadata.memoryWrites,
        memoryWritesSkipped: metadata.memoryWritesSkipped,
        memoryRetrieved: metadata.memoryReads.map((memoryRead) => memoryRead.candidateId),
        memoryUsedInDecision: metadata.memoryReads
          .filter((memoryRead) => memoryRead.usedInDecision)
          .map((memoryRead) => memoryRead.candidateId),
        memoryImpact:
          metadata.memoryReads.find((memoryRead) => memoryRead.usedInDecision)?.impact ??
          runResult.scenario.memoryEvaluationSpec?.expectedMemoryImpact ??
          null,
        memoryFailureTypes: classifyWorkspaceMemoryFailureTypes(
          runResult,
          execution,
          metadata
        ),
        graphPath:
          metadata.graphPath.length > 0
            ? metadata.graphPath
            : [
                ...new Set([
                  ...runResult.scenario.trajectoryHints.expectedNodes,
                  ...runResult.scenario.driftEvaluationSpec.trajectory.requiredSteps
                ])
              ],
        latencyMs: metadata.latencyMs ?? sumRetrievalLatencies(metadata.retrievalEvents),
        contextMetrics: metadata.contextMetrics ?? createFallbackContextMetrics(runResult),
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
  execution: ScenarioExecutionResult,
  metadata: z.infer<typeof workspaceAgentMetadataSchema>
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
  const expectedRetrieveIds = new Set(memorySpec.memoryCheckpoints
    .filter((checkpoint) => checkpoint.turnId === turnId && checkpoint.expectedAction === "retrieve")
    .flatMap((checkpoint) => checkpoint.relatedOpportunityIds));
  const expectedWriteIds = new Set(memorySpec.memoryOpportunities
    .filter((opportunity) => opportunity.worthKeeping && opportunity.relatedTurnIds.includes(turnId))
    .map((opportunity) => opportunity.opportunityId));
  const retrievedIds = new Set(metadata.memoryReads.map((memoryRead) => memoryRead.candidateId));
  const writtenIds = new Set(metadata.memoryWrites.map((memoryWrite) => memoryWrite.candidateId));

  if ([...expectedWriteIds].some((opportunityId) => !writtenIds.has(opportunityId))) {
    failureTypes.add("missed_needed_write");
  }

  if ([...expectedRetrieveIds].some((opportunityId) => !retrievedIds.has(opportunityId))) {
    failureTypes.add("missed_needed_retrieval");
  }

  if (metadata.memoryReads.some((memoryRead) => !memoryRead.neededNow)) {
    failureTypes.add("irrelevant_retrieval");
  }

  const notWorthKeepingIds = new Set(
    memorySpec.memoryOpportunities
      .filter((opportunity) => !opportunity.worthKeeping)
      .map((opportunity) => opportunity.opportunityId)
  );

  if ([...writtenIds].some((opportunityId) => notWorthKeepingIds.has(opportunityId))) {
    failureTypes.add("wasteful_save");
  }

  return [...failureTypes];
}

function sumRetrievalLatencies(
  retrievalEvents: Array<{ latencyMs: number }>
): number {
  return retrievalEvents.reduce(
    (totalLatency, retrievalEvent) => totalLatency + retrievalEvent.latencyMs,
    0
  );
}

function createFallbackContextMetrics(runResult: ScenarioRunResult) {
  return {
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
  };
}

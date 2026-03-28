import { z } from "zod";

import type { NormalizedEvaluationRecord } from "../contracts/normalized-evaluation-record.js";
import type {
  ScenarioExecutionResult,
  ScenarioRunResult
} from "../../runtime/runner/scenario-runner.js";
import { NormalizedRecordBuilder } from "./normalized-record-builder.js";

const toolChainMetadataSchema = z.object({
  graphPath: z.array(z.string()).default([]),
  groundedEvidenceRefs: z.array(z.string()).default([]),
  toolSpecsCreated: z.array(
    z.object({
      toolName: z.string(),
      description: z.string(),
      inputSchemaSummary: z.string().optional(),
      reusedExistingTool: z.boolean().default(false)
    })
  ).default([]),
  toolCalls: z.array(
    z.object({
      callId: z.string(),
      toolName: z.string(),
      status: z.enum(["succeeded", "failed", "skipped"]),
      latencyMs: z.number(),
      inputSummary: z.string(),
      outputSummary: z.string(),
      consumedBudget: z.number().default(0),
      contextTokensUsed: z.number().default(0),
      inputArtifactRefs: z.array(z.string()).default([]),
      outputArtifactRefs: z.array(z.string()).default([])
    })
  ).default([]),
  budgetLedger: z.array(
    z.object({
      budgetName: z.string(),
      scope: z.enum(["run", "turn", "tool", "subagent"]),
      allocated: z.number(),
      consumed: z.number(),
      remaining: z.number(),
      unit: z.enum(["tools", "tokens", "seconds"]),
      withinBudget: z.boolean()
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
  multimodalNormalizationEvents: z.array(
    z.object({
      modality: z.string(),
      strategy: z.enum(["inline_summary", "structured_summary"]),
      sourceArtifactRefs: z.array(z.string()).default([]),
      sourceTokenCount: z.number().default(0),
      normalizedTokenCount: z.number()
    })
  ).default([])
});

export class ToolChainAgentAdapter {
  constructor(private readonly builder = new NormalizedRecordBuilder()) {}

  normalize(
    runResult: ScenarioRunResult,
    execution: ScenarioExecutionResult
  ): NormalizedEvaluationRecord {
    const metadata = toolChainMetadataSchema.parse(execution.agentResult.metadata ?? {});
    const memoryFailureTypes = classifyMemoryFailureTypes(
      runResult,
      metadata.memoryWrites.length,
      metadata.memoryReads.length
    );

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
        toolSpecsCreated: metadata.toolSpecsCreated,
        toolCalls: metadata.toolCalls,
        budgetLedger: metadata.budgetLedger,
        memoryCandidatesObserved: metadata.memoryCandidatesObserved,
        memoryReads: metadata.memoryReads,
        memoryWrites: metadata.memoryWrites,
        memoryWritesSkipped: metadata.memoryWritesSkipped,
        memoryRetrieved: metadata.memoryReads.map((memoryRead) => memoryRead.candidateId),
        memoryUsedInDecision: metadata.memoryReads
          .filter((memoryRead) => memoryRead.usedInDecision)
          .map((memoryRead) => memoryRead.candidateId),
        memoryImpact:
          metadata.memoryReads.find((memoryRead) => memoryRead.usedInDecision)?.impact ?? null,
        memoryFailureTypes,
        graphPath: metadata.graphPath,
        latencyMs: sumToolLatencies(metadata.toolCalls),
        contextMetrics:
          metadata.contextMetrics ??
          createFallbackContextMetrics(runResult, metadata.toolCalls),
        tokenUsage: {
          ...execution.agentResult.tokenUsage,
          cachedInputTokens: 0
        }
      }
    });
  }
}

function sumToolLatencies(
  toolCalls: Array<{ latencyMs: number }>
): number {
  return toolCalls.reduce((totalLatency, toolCall) => totalLatency + toolCall.latencyMs, 0);
}

function createFallbackContextMetrics(
  runResult: ScenarioRunResult,
  toolCalls: Array<{ contextTokensUsed: number }>
) {
  const retrievedContextTokens = toolCalls.reduce(
    (totalTokens, toolCall) => totalTokens + toolCall.contextTokensUsed,
    0
  );

  return {
    contextWindowSizeTokens: 128_000,
    promptTokens:
      runResult.scenario.contextEvaluationSpec.systemPromptProfile.fixedTokenOverhead +
      runResult.scenario.contextEvaluationSpec.systemPromptProfile.dynamicTokenOverhead +
      runResult.scenario.contextEvaluationSpec.toolSurfaceProfile.toolDefinitionTokenOverhead,
    retrievedContextTokens,
    relevantContextTokens: retrievedContextTokens,
    unusedContextTokens: 0,
    workspaceArtifactTokens: runResult.environment.registryEntries.length * 15,
    subagentCommunicationTokens: 0
  };
}

function classifyMemoryFailureTypes(
  runResult: ScenarioRunResult,
  writeCount: number,
  readCount: number
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
  const hasNeededLaterOpportunity = memorySpec.memoryOpportunities.some(
    (opportunity) => opportunity.neededLater
  );
  const hasWorthKeepingOpportunity = memorySpec.memoryOpportunities.some(
    (opportunity) => opportunity.worthKeeping
  );
  const hasNotWorthKeepingOpportunity = memorySpec.memoryOpportunities.some(
    (opportunity) => !opportunity.worthKeeping
  );

  if (hasWorthKeepingOpportunity && writeCount === 0) {
    failureTypes.add("missed_needed_write");
  }

  if (hasNeededLaterOpportunity && readCount === 0) {
    failureTypes.add("missed_needed_retrieval");
  }

  if (hasNotWorthKeepingOpportunity && writeCount > 0) {
    failureTypes.add("wasteful_save");
  }

  return [...failureTypes];
}

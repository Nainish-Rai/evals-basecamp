import { z } from "zod";

import { modelTierSchema } from "../../domain/agents/model-tier-schema.js";
import {
  expectedMemoryImpactSchema,
  memoryFailureTypeSchema,
  memoryScopeSchema,
  memorySourceSchema
} from "../../domain/scenarios/memory-evaluation-schema.js";
import {
  agentFamilySchema,
  taskFamilySchema
} from "../../domain/scenarios/scenario-parts.js";
import { trajectoryContractSchema } from "./trajectory-contract.js";

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0)
});

const toolSpecSchema = z.object({
  toolName: z.string().min(1),
  description: z.string().min(1),
  inputSchemaSummary: z.string().min(1).optional(),
  reusedExistingTool: z.boolean().default(false)
});

const toolCallSchema = z
  .object({
    callId: z.string().min(1),
    toolName: z.string().min(1),
    status: z.enum(["succeeded", "failed", "skipped"]),
    latencyMs: z.number().nonnegative(),
    inputSummary: z.string().min(1),
    outputSummary: z.string().min(1),
    consumedBudget: z.number().nonnegative().default(0),
    contextTokensUsed: z.number().int().nonnegative().default(0),
    inputArtifactRefs: z.array(z.string().min(1)).default([]),
    outputArtifactRefs: z.array(z.string().min(1)).default([])
  })
  .superRefine((value, context) => {
    if (value.status === "succeeded" && value.outputArtifactRefs.length === 0) {
      return;
    }

    if (value.status === "failed" && value.outputSummary.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed tool calls must keep an output summary",
        path: ["outputSummary"]
      });
    }
  });

const budgetLedgerEntrySchema = z
  .object({
    budgetName: z.string().min(1),
    scope: z.enum(["run", "turn", "tool", "subagent"]),
    allocated: z.number().nonnegative(),
    consumed: z.number().nonnegative(),
    remaining: z.number().nonnegative(),
    unit: z.enum(["tools", "tokens", "seconds"]),
    withinBudget: z.boolean()
  })
  .superRefine((value, context) => {
    if (value.consumed > value.allocated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "consumed budget cannot exceed allocated budget",
        path: ["consumed"]
      });
    }

    if (value.remaining !== value.allocated - value.consumed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remaining budget must match allocated minus consumed",
        path: ["remaining"]
      });
    }
  });

const retrievalEventSchema = z
  .object({
    retrievalId: z.string().min(1),
    sourceId: z.string().min(1),
    query: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    retrievedTokenCount: z.number().int().nonnegative(),
    relevantTokenCount: z.number().int().nonnegative(),
    selectedArtifactRefs: z.array(z.string().min(1)).default([]),
    relevantArtifactRefs: z.array(z.string().min(1)).default([]),
    usedArtifactRefs: z.array(z.string().min(1)).default([])
  })
  .superRefine((value, context) => {
    if (value.selectedCount > value.candidateCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selected count cannot exceed candidate count",
        path: ["selectedCount"]
      });
    }

    if (value.relevantTokenCount > value.retrievedTokenCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "relevant token count cannot exceed retrieved token count",
        path: ["relevantTokenCount"]
      });
    }
  });

const filesystemArtifactSchema = z.object({
  artifactId: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["input", "generated", "workspace"]),
  tokenCount: z.number().int().nonnegative().default(0)
});

const subagentEventSchema = z.object({
  subagentId: z.string().min(1),
  model: z.string().min(1),
  modelTier: modelTierSchema,
  taskSummary: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"])
});

const memoryCandidateSchema = z.object({
  candidateId: z.string().min(1),
  summary: z.string().min(1)
});

const memoryDecisionSchema = memoryCandidateSchema.extend({
  source: memorySourceSchema,
  scope: memoryScopeSchema,
  rationale: z.string().min(1)
});

const memoryReadSchema = memoryCandidateSchema.extend({
  source: memorySourceSchema,
  scope: memoryScopeSchema,
  neededNow: z.boolean(),
  usedInDecision: z.boolean(),
  impact: expectedMemoryImpactSchema
});

const contextMetricsSchema = z
  .object({
    contextWindowSizeTokens: z.number().int().positive(),
    promptTokens: z.number().int().nonnegative(),
    retrievedContextTokens: z.number().int().nonnegative(),
    relevantContextTokens: z.number().int().nonnegative(),
    unusedContextTokens: z.number().int().nonnegative(),
    workspaceArtifactTokens: z.number().int().nonnegative(),
    subagentCommunicationTokens: z.number().int().nonnegative()
  })
  .superRefine((value, context) => {
    if (value.relevantContextTokens > value.retrievedContextTokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "relevant context tokens cannot exceed retrieved context tokens",
        path: ["relevantContextTokens"]
      });
  }
  });

const trajectorySchema = trajectoryContractSchema;

export const normalizedEvaluationRecordSchema = z.object({
  scenarioId: z.string().min(1),
  runId: z.string().min(1),
  agentFamily: agentFamilySchema,
  taskFamily: taskFamilySchema,
  turnId: z.string().min(1),
  inputTask: z.string().min(1),
  feedbackInputs: z.array(z.string().min(1)).default([]),
  finalResponse: z.string().min(1),
  groundedEvidenceRefs: z.array(z.string().min(1)).default([]),
  toolSpecsCreated: z.array(toolSpecSchema).default([]),
  toolCalls: z.array(toolCallSchema).default([]),
  budgetLedger: z.array(budgetLedgerEntrySchema).default([]),
  retrievalEvents: z.array(retrievalEventSchema).default([]),
  filesystemArtifacts: z.array(filesystemArtifactSchema).default([]),
  subagentEvents: z.array(subagentEventSchema).default([]),
  memoryCandidatesObserved: z.array(memoryCandidateSchema).default([]),
  memoryReads: z.array(memoryReadSchema).default([]),
  memoryWrites: z.array(memoryDecisionSchema).default([]),
  memoryWritesSkipped: z.array(memoryDecisionSchema).default([]),
  memorySources: z.array(memorySourceSchema).default([]),
  memoryScopes: z.array(memoryScopeSchema).default([]),
  memoryWorthKeeping: z.array(z.string().min(1)).default([]),
  memoryRetrieved: z.array(z.string().min(1)).default([]),
  memoryNeededNow: z.array(z.string().min(1)).default([]),
  memoryUsedInDecision: z.array(z.string().min(1)).default([]),
  memoryImpact: expectedMemoryImpactSchema.nullable(),
  memoryFailureTypes: z.array(memoryFailureTypeSchema).default([]),
  trajectory: trajectorySchema,
  graphPath: z.array(z.string().min(1)).default([]),
  latencyMs: z.number().nonnegative(),
  contextMetrics: contextMetricsSchema,
  tokenUsage: tokenUsageSchema,
  langfuseTraceId: z.string().min(1).nullable()
});

export type NormalizedEvaluationRecord = z.infer<
  typeof normalizedEvaluationRecordSchema
>;

import { z } from "zod";

import { feedbackEventSchema } from "../../../domain/feedback/feedback-event-schema.js";
import { evalExampleSchema } from "./eval-example-schema.js";

const traceScoreSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  comment: z.string().optional()
});

const traceSpanSchema = z.object({
  spanId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  name: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  scores: z.array(traceScoreSchema),
  errorMessage: z.string().nullable()
});

const traceEventSchema = z.object({
  eventId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  name: z.string().min(1),
  recordedAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown())
});

export const traceExportSchema = z.object({
  traceId: z.string().nullable(),
  enabled: z.boolean(),
  traceName: z.string().nullable(),
  status: z.enum(["completed", "failed"]),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  scores: z.array(traceScoreSchema),
  spans: z.array(traceSpanSchema),
  events: z.array(traceEventSchema),
  vendorTraceIds: z.array(z.string().min(1))
});

export const evaluationCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  description: z.string().min(1)
});

export const evaluationStaticOverheadSchema = z.object({
  systemPromptTokens: z.number().int().nonnegative().default(0),
  toolDefinitionTokens: z.number().int().nonnegative().default(0)
});

export const evaluationContextSchema = z.object({
  minimumCorrectnessThreshold: z.number().min(0).max(1).default(0.75),
  requiredFindings: z.array(z.string().min(1)).default([]),
  expectedEvidenceRefs: z.array(z.string().min(1)).default([]),
  correctnessExpectation: z.string().min(1).optional(),
  expectedDisposition: z.string().min(1).optional(),
  requiredContext: z.array(z.string().min(1)).default([]),
  optionalContext: z.array(z.string().min(1)).default([]),
  distractorContext: z.array(z.string().min(1)).default([]),
  duplicateContext: z.array(z.string().min(1)).default([]),
  staleContext: z.array(z.string().min(1)).default([]),
  expectedActiveTools: z.array(z.string().min(1)).default([]),
  overlappingToolNames: z.array(z.string().min(1)).default([]),
  memoryCheckpoints: z.array(evaluationCheckpointSchema).default([]),
  contextCheckpoints: z.array(evaluationCheckpointSchema).default([]),
  staticOverhead: evaluationStaticOverheadSchema.default({
    systemPromptTokens: 0,
    toolDefinitionTokens: 0
  })
});

export const runBundleSchema = z.object({
  bundleId: z.string().min(1),
  example: evalExampleSchema,
  mode: z.enum(["initial", "feedback_rerun"]),
  runId: z.string().min(1),
  runBatchId: z.string().min(1),
  traceId: z.string().min(1).nullable(),
  feedbackTurns: z.array(feedbackEventSchema).default([]),
  evaluationContext: evaluationContextSchema.default({
    minimumCorrectnessThreshold: 0.75,
    requiredFindings: [],
    expectedEvidenceRefs: [],
    requiredContext: [],
    optionalContext: [],
    distractorContext: [],
    duplicateContext: [],
    staleContext: [],
    expectedActiveTools: [],
    overlappingToolNames: [],
    memoryCheckpoints: [],
    contextCheckpoints: [],
    staticOverhead: {
      systemPromptTokens: 0,
      toolDefinitionTokens: 0
    }
  }),
  feedbackIds: z.array(z.string().min(1)).default([]),
  finalResponse: z.string().min(1),
  outputArtifacts: z.array(z.string().min(1)).default([]),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  }),
  agentMetadata: z.record(z.string(), z.unknown()).default({}),
  trace: traceExportSchema.nullable(),
  collectedAt: z.string().min(1),
  agentLabel: z.string().min(1).default("scenario-runner"),
  modelLabel: z.string().min(1).default("unknown")
});

export type RunBundle = z.infer<typeof runBundleSchema>;
export type TraceExportRecord = z.infer<typeof traceExportSchema>;

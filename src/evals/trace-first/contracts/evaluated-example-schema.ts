import { z } from "zod";

import { metricResultSchema } from "../../contracts/metric-result-schema.js";

export const participantContextScoreSchema = z.object({
  participantId: z.string().min(1),
  participantType: z.enum(["supervisor", "subagent"]),
  complete: z.boolean(),
  score: z.number().min(0).max(1)
});

export const driftSummarySchema = z.object({
  variantGroupId: z.string().min(1),
  variantCount: z.number().int().nonnegative(),
  status: z.enum(["passed", "failed", "insufficient_variants"]),
  memoryMean: z.number().min(0).max(1).nullable(),
  memoryStdDev: z.number().nonnegative().nullable(),
  memoryCoefficientOfVariation: z.number().nonnegative().nullable(),
  contextMean: z.number().min(0).max(1).nullable(),
  contextStdDev: z.number().nonnegative().nullable(),
  contextCoefficientOfVariation: z.number().nonnegative().nullable()
});

export const evaluatedExampleSchema = z.object({
  exampleId: z.string().min(1),
  variantGroupId: z.string().min(1),
  taskType: z.string().min(1),
  mode: z.enum(["initial", "feedback_rerun"]),
  accuracyScore: z.number().min(0).max(1),
  domainCorrectnessScore: z.number().min(0).max(1),
  feedbackIntegrationScore: z.number().min(0).max(1),
  accuracyBin: z.string().min(1),
  memoryScore: z.number().min(0).max(1),
  memoryState: z.string().min(1),
  memoryPassed: z.boolean(),
  contextScore: z.number().min(0).max(1),
  contextPassed: z.boolean(),
  retryAttribution: z.object({
    systemPromptVagueness: z.number().int().nonnegative(),
    toolDefinitionAmbiguity: z.number().int().nonnegative(),
    missingContext: z.number().int().nonnegative(),
    other: z.number().int().nonnegative()
  }),
  peerMetrics: z.object({
    systemPromptTokens: z.number().int().nonnegative(),
    toolDefinitionTokens: z.number().int().nonnegative(),
    multimodalRawTokens: z.number().int().nonnegative(),
    multimodalCompressedTokens: z.number().int().nonnegative(),
    toolRetryCount: z.number().int().nonnegative()
  }),
  participantContextScores: z.array(participantContextScoreSchema),
  metricResults: z.array(metricResultSchema).default([]),
  drift: driftSummarySchema.optional()
});

export type EvaluatedExample = z.infer<typeof evaluatedExampleSchema>;
export type DriftSummary = z.infer<typeof driftSummarySchema>;

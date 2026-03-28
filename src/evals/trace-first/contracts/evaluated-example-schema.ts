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

export const contextDiagnosticsSchema = z.object({
  contextPrecision: z.number().min(0).max(1),
  contextRecall: z.number().min(0).max(1),
  systemPromptTokenOverhead: z.number().int().nonnegative(),
  toolDefinitionTokenOverhead: z.number().int().nonnegative(),
  tokenToValueRatio: z.number().nonnegative(),
  contextBloatIndex: z.number().min(0).max(1),
  duplicateContextRate: z.number().min(0).max(1),
  contextPartitionEfficiency: z.number().min(0).max(1),
  artifactReuseRate: z.number().min(0).max(1),
  activeToolSurfaceArea: z.number().int().nonnegative(),
  unusedToolDefinitionRatio: z.number().min(0).max(1),
  duplicateToolDefinitionRate: z.number().min(0).max(1),
  toolOverlapRate: z.number().min(0).max(1),
  fileReadRedundancyRate: z.number().min(0).max(1)
});

export const evaluatedExampleSchema = z.object({
  bundleId: z.string().min(1),
  exampleId: z.string().min(1),
  variantGroupId: z.string().min(1),
  runId: z.string().min(1),
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
  contextDiagnostics: contextDiagnosticsSchema,
  metricResults: z.array(metricResultSchema).default([]),
  drift: driftSummarySchema.optional()
});

export type EvaluatedExample = z.infer<typeof evaluatedExampleSchema>;
export type DriftSummary = z.infer<typeof driftSummarySchema>;

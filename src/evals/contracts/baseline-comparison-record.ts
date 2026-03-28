import { z } from "zod";

import { baselineComparisonModeSchema } from "../../domain/scenarios/drift-evaluation-schema.js";

const metricSnapshotSchema = z.object({
  bundleId: z.string().min(1),
  exampleId: z.string().min(1),
  runId: z.string().min(1),
  mode: z.enum(["initial", "feedback_rerun"]),
  accuracyScore: z.number().min(0).max(1),
  domainCorrectnessScore: z.number().min(0).max(1),
  feedbackIntegrationScore: z.number().min(0).max(1),
  memoryScore: z.number().min(0).max(1),
  trajectoryScore: z.number().min(0).max(1),
  contextScore: z.number().min(0).max(1),
  responseQualityScore: z.number().min(0).max(1).nullable().default(null)
});

const metricDeltaSchema = z.object({
  accuracyScoreDelta: z.number().min(-1).max(1),
  domainCorrectnessScoreDelta: z.number().min(-1).max(1),
  feedbackIntegrationScoreDelta: z.number().min(-1).max(1),
  memoryScoreDelta: z.number().min(-1).max(1),
  trajectoryScoreDelta: z.number().min(-1).max(1),
  contextScoreDelta: z.number().min(-1).max(1),
  responseQualityScoreDelta: z.number().min(-1).max(1).nullable()
});

export const feedbackRerunComparisonRecordSchema = z.object({
  comparisonId: z.string().min(1),
  benchmarkSubset: z.string().min(1),
  baselineComparisonMode: baselineComparisonModeSchema,
  variantGroupId: z.string().min(1),
  taskFamily: z.string().min(1),
  agentFamily: z.string().min(1),
  comparisonStatus: z.enum(["stable", "improved", "regressed", "mixed"]),
  current: metricSnapshotSchema,
  baseline: metricSnapshotSchema,
  deltas: metricDeltaSchema,
  driftClassification: z.enum([
    "quality_preserving_variation",
    "outcome_only_drift",
    "trajectory_only_drift",
    "combined_drift",
    "unclassified"
  ]),
  pairMetricFamilies: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export type FeedbackRerunComparisonRecord = z.infer<
  typeof feedbackRerunComparisonRecordSchema
>;

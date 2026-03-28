import { z } from "zod";

const exampleMetricSnapshotSchema = z.object({
  exampleId: z.string().min(1),
  variantGroupId: z.string().min(1),
  runId: z.string().min(1),
  agentLabel: z.string().min(1),
  modelLabel: z.string().min(1),
  mode: z.enum(["initial", "feedback_rerun"]),
  domainCorrectnessScore: z.number().min(0).max(1),
  trajectoryScore: z.number().min(0).max(1),
  contextScore: z.number().min(0).max(1),
  memoryScore: z.number().min(0).max(1),
  responseQualityScore: z.number().min(0).max(1).nullable()
});

const exampleMetricDeltaSchema = z.object({
  domainCorrectnessScoreDelta: z.number().min(-1).max(1),
  trajectoryScoreDelta: z.number().min(-1).max(1),
  contextScoreDelta: z.number().min(-1).max(1),
  memoryScoreDelta: z.number().min(-1).max(1),
  responseQualityScoreDelta: z.number().min(-1).max(1).nullable()
});

export const historicalRegressionComparisonRecordSchema = z.object({
  comparisonKey: z.string().min(1),
  subsetId: z.string().min(1),
  comparisonStatus: z.enum(["stable", "improved", "regressed", "mixed"]),
  current: exampleMetricSnapshotSchema,
  baseline: exampleMetricSnapshotSchema,
  deltas: exampleMetricDeltaSchema,
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export type HistoricalRegressionComparisonRecord = z.infer<
  typeof historicalRegressionComparisonRecordSchema
>;

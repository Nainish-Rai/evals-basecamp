import { z } from "zod";

export const metricFamilySchema = z.enum([
  "response_quality_drift",
  "context_efficiency",
  "context_counterfactual",
  "memory_utilization",
  "domain_correctness",
  "feedback_integration",
  "trajectory",
  "trajectory_coverage"
]);

export const metricResultSchema = z.object({
  metricId: z.string().min(1),
  metricFamily: metricFamilySchema,
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([])
});

export type MetricResult = z.infer<typeof metricResultSchema>;

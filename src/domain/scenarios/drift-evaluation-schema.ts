import { z } from "zod";

export const allowedStepFlexibilitySchema = z.enum([
  "exact",
  "partial",
  "unordered"
]);

export const driftCriticalitySchema = z.enum([
  "quality_preserving_variation",
  "trajectory_only_drift",
  "outcome_only_drift",
  "combined_drift"
]);

export const baselineComparisonModeSchema = z.enum([
  "absolute_rubric_scoring",
  "baseline_relative_comparison"
]);

export const expectedOutcomeCriteriaSchema = z.object({
  correctnessExpectation: z.string().min(1),
  requiredFindings: z.array(z.string().min(1)).min(1),
  requiredEvidenceRefs: z.array(z.string().min(1)).default([]),
  expectedDisposition: z.string().min(1)
});

export const driftTrajectorySpecSchema = z.object({
  requiredSteps: z.array(z.string().min(1)).default([]),
  criticalTools: z.array(z.string().min(1)).default([]),
  criticalDelegations: z.array(z.string().min(1)).default([])
});

export const driftEvaluationSpecSchema = z.object({
  expectedOutcomeCriteria: expectedOutcomeCriteriaSchema,
  trajectory: driftTrajectorySpecSchema,
  allowedStepFlexibility: allowedStepFlexibilitySchema,
  driftCriticality: driftCriticalitySchema,
  baselineComparisonMode: baselineComparisonModeSchema
});

export type DriftEvaluationSpec = z.infer<typeof driftEvaluationSpecSchema>;

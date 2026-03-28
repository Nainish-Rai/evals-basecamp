import { z } from "zod";

export const regressionThresholdsSchema = z.object({
  maxDomainCorrectnessMeanDrop: z.number().min(0).max(1),
  maxTrajectoryMeanDrop: z.number().min(0).max(1),
  maxContextMeanDrop: z.number().min(0).max(1),
  maxMemoryMeanDrop: z.number().min(0).max(1),
  maxResponseQualityMeanDrop: z.number().min(0).max(1),
  maxPerExampleDrop: z.number().min(0).max(1),
  minComparableExampleRate: z.number().min(0).max(1)
});

export type RegressionThresholds = z.infer<typeof regressionThresholdsSchema>;

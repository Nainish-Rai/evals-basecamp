import { z } from "zod";

import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import { allowedStepFlexibilitySchema } from "../../domain/scenarios/drift-evaluation-schema.js";

export const trajectoryContractSchema = z.object({
  requiredSteps: z.array(z.string().min(1)).default([]),
  criticalTools: z.array(z.string().min(1)).default([]),
  criticalDelegations: z.array(z.string().min(1)).default([]),
  allowedStepFlexibility: allowedStepFlexibilitySchema.default("partial"),
  allowAdditionalSteps: z.boolean().default(true)
});

export type TrajectoryContract = z.infer<typeof trajectoryContractSchema>;

export function buildTrajectoryContract(
  trajectorySource: Pick<
    Scenario["driftEvaluationSpec"],
    "trajectory" | "allowedStepFlexibility"
  > & {
    allowAdditionalSteps?: boolean;
  }
): TrajectoryContract {
  return trajectoryContractSchema.parse({
    requiredSteps: trajectorySource.trajectory.requiredSteps,
    criticalTools: trajectorySource.trajectory.criticalTools,
    criticalDelegations: trajectorySource.trajectory.criticalDelegations,
    allowedStepFlexibility: trajectorySource.allowedStepFlexibility,
    allowAdditionalSteps: trajectorySource.allowAdditionalSteps ?? true
  });
}

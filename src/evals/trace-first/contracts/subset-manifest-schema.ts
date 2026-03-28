import { z } from "zod";

import { regressionThresholdsSchema } from "../../contracts/regression-thresholds-schema.js";

export const subsetManifestSchema = z.object({
  subsetId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  expectedScenarioIds: z.array(z.string().min(1)).min(1),
  regressionThresholds: regressionThresholdsSchema
});

export type SubsetManifest = z.infer<typeof subsetManifestSchema>;

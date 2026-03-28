import { z } from "zod";

import { evaluatedExampleSchema } from "./evaluated-example-schema.js";
import { subsetManifestSchema } from "./subset-manifest-schema.js";

export const baselineArtifactSchema = z.object({
  artifactVersion: z.literal(1),
  subset: subsetManifestSchema,
  createdAt: z.string().min(1),
  sourceCommit: z.string().min(1).nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
  evaluationSummary: z
    .object({
      evaluatedExampleCount: z.number().int().nonnegative(),
      metricResultCount: z.number().int().nonnegative()
    })
    .default({
      evaluatedExampleCount: 0,
      metricResultCount: 0
    }),
  metricAverages: z.record(z.string(), z.unknown()).default({}),
  examples: z.array(evaluatedExampleSchema)
});

export type BaselineArtifact = z.infer<typeof baselineArtifactSchema>;

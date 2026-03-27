import { z } from "zod";

export const syntheticPackReferenceSchema = z.object({
  referenceId: z.string().min(1),
  packId: z.string().min(1),
  entryIds: z.array(z.string().min(1)).min(1),
  purpose: z.string().min(1),
  materializationTargets: z
    .array(z.enum(["artifacts", "data_sources", "workspace"]))
    .min(1),
  destinationPath: z.string().min(1)
});

export const scenarioMaterializationSchema = z.object({
  workspaceRoot: z.string().min(1).default("workspace"),
  includeScenarioArtifacts: z.boolean().default(true),
  syntheticPackReferenceOrder: z.array(z.string().min(1)).default([])
});

export type SyntheticPackReference = z.infer<typeof syntheticPackReferenceSchema>;

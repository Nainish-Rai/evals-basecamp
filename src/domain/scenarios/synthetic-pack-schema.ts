import { z } from "zod";

import {
  artifactSchema,
  dataSourceSchema,
  taskFamilySchema
} from "./scenario-parts.js";

export const syntheticPackEntrySchema = z.object({
  entryId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  artifacts: z.array(artifactSchema).default([]),
  dataSources: z.array(dataSourceSchema).default([]),
  facts: z.record(z.string(), z.unknown()).default({})
});

export const syntheticPackSchema = z.object({
  packId: z.string().min(1),
  taskFamily: taskFamilySchema,
  version: z.string().min(1),
  description: z.string().min(1),
  entries: z.array(syntheticPackEntrySchema).min(1)
});

export type SyntheticPack = z.infer<typeof syntheticPackSchema>;
export type SyntheticPackEntry = z.infer<typeof syntheticPackEntrySchema>;

import { z } from "zod";

export const evalSkillSchema = z.object({
  skillId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional()
});

export const evalDataItemSchema = z.object({
  dataId: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1).optional(),
  summary: z.string().min(1),
  sourceKind: z.string().min(1).optional()
});

export const evalCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  description: z.string().min(1)
});

export const evalStaticOverheadSchema = z.object({
  systemPromptTokens: z.number().int().nonnegative().default(0),
  toolDefinitionTokens: z.number().int().nonnegative().default(0)
});

export const evalExampleSpecSchema = z.object({
  instruction: z.string().min(1),
  minimumCorrectnessThreshold: z.number().min(0).max(1).default(0.75),
  requiredFindings: z.array(z.string().min(1)).default([]),
  expectedEvidenceRefs: z.array(z.string().min(1)).default([]),
  expectedDisposition: z.string().min(1).optional(),
  memoryCheckpoints: z.array(evalCheckpointSchema).default([]),
  contextCheckpoints: z.array(evalCheckpointSchema).default([]),
  staticOverhead: evalStaticOverheadSchema.default({
    systemPromptTokens: 0,
    toolDefinitionTokens: 0
  })
});

export const evalExampleSchema = z.object({
  exampleId: z.string().min(1),
  variantGroupId: z.string().min(1),
  taskType: z.string().min(1),
  sourceScenarioId: z.string().min(1).optional(),
  task: z.string().min(1),
  skills: z.array(evalSkillSchema).default([]),
  data: z.array(evalDataItemSchema).default([]),
  evaluationSpec: evalExampleSpecSchema
});

export type EvalExample = z.infer<typeof evalExampleSchema>;
export type EvalExampleSpec = z.infer<typeof evalExampleSpecSchema>;

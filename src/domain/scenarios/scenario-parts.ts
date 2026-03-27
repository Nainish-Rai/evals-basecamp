import { z } from "zod";

export const agentFamilySchema = z.enum(["tool_chain", "workspace"]);
export const taskFamilySchema = z.enum([
  "compliance",
  "governance",
  "investigation",
  "risk"
]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const modalitySchema = z.enum([
  "text",
  "image",
  "pdf",
  "table",
  "audio"
]);

export const artifactSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.enum([
    "document",
    "image",
    "spreadsheet",
    "timeline",
    "policy",
    "dataset"
  ]),
  title: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional()
});

export const dataSourceSchema = z.object({
  sourceId: z.string().min(1),
  kind: z.enum(["database", "filesystem", "api", "search_index"]),
  description: z.string().min(1)
});

export const trajectoryHintSchema = z.object({
  expectedNodes: z.array(z.string().min(1)).default([]),
  requiredSteps: z.array(z.string().min(1)).default([]),
  expectedTools: z.array(z.string().min(1)).default([]),
  criticalDelegations: z.array(z.string().min(1)).default([]),
  allowAdditionalSteps: z.boolean().default(true)
});

export const memoryTargetSchema = z.object({
  targetId: z.string().min(1),
  description: z.string().min(1),
  mustRetainAfterFeedback: z.boolean().default(false)
});

export const evaluationRubricSchema = z.object({
  requiredChecks: z.array(z.string().min(1)).min(1),
  optionalChecks: z.array(z.string().min(1)).default([]),
  prohibitedFailures: z.array(z.string().min(1)).default([])
});

export type AgentFamily = z.infer<typeof agentFamilySchema>;
export type TaskFamily = z.infer<typeof taskFamilySchema>;

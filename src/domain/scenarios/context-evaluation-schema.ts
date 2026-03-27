import { z } from "zod";

import { modalitySchema } from "./scenario-parts.js";

export const contextScenarioTypeSchema = z.enum([
  "minimal_sufficient_context",
  "under_context_failure",
  "over_context_bloat",
  "wrong_context_retrieval",
  "duplicate_context_waste",
  "misordered_context",
  "mispartitioned_context",
  "stale_or_superseded_context",
  "artifact_reuse_vs_regeneration",
  "budget_constrained_prioritization"
]);

export const systemPromptProfileSchema = z.object({
  fixedTokenOverhead: z.number().int().nonnegative(),
  dynamicTokenOverhead: z.number().int().nonnegative()
});

export const toolSurfaceProfileSchema = z.object({
  expectedActiveTools: z.array(z.string().min(1)).default([]),
  overlappingToolNames: z.array(z.string().min(1)).default([]),
  duplicateToolRisk: z.enum(["low", "medium", "high"]),
  toolDefinitionTokenOverhead: z.number().int().nonnegative(),
  ambiguityHotspots: z.array(z.string().min(1)).default([])
});

export const agentRenderingNotesSchema = z.object({
  toolChain: z.string().min(1),
  workspace: z.string().min(1)
});

export const multimodalOptimizationExpectationSchema = z.object({
  modality: modalitySchema,
  expectation: z.string().min(1)
});

export const fileReadCleanupExpectationSchema = z.object({
  pathPattern: z.string().min(1),
  expectation: z.enum(["ephemeral_read", "avoid_repeat_read"]),
  rationale: z.string().min(1)
});

export const contextEvaluationSpecSchema = z.object({
  minimumCorrectnessThreshold: z.number().min(0).max(1),
  systemPromptProfile: systemPromptProfileSchema,
  toolSurfaceProfile: toolSurfaceProfileSchema,
  requiredContext: z.array(z.string().min(1)).min(1),
  optionalContext: z.array(z.string().min(1)).default([]),
  distractorContext: z.array(z.string().min(1)).default([]),
  duplicateContext: z.array(z.string().min(1)).default([]),
  staleContext: z.array(z.string().min(1)).default([]),
  contextScenarioType: contextScenarioTypeSchema,
  agentRenderingNotes: agentRenderingNotesSchema,
  multimodalOptimizationExpectations: z
    .array(multimodalOptimizationExpectationSchema)
    .default([]),
  fileReadCleanupExpectations: z
    .array(fileReadCleanupExpectationSchema)
    .default([])
});

export type ContextEvaluationSpec = z.infer<typeof contextEvaluationSpecSchema>;

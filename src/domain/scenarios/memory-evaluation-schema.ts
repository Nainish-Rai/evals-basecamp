import { z } from "zod";

export const memorySourceSchema = z.enum(["trace_tool_file", "user", "pattern"]);
export const memoryScopeSchema = z.enum(["step", "case", "cross_case"]);
export const expectedMemoryImpactSchema = z.enum([
  "positive",
  "neutral",
  "negative"
]);

export const expectedMemoryStateSchema = z.enum([
  "correct_save_correct_abstention_from_retrieval",
  "correct_save_irrelevant_retrieval",
  "missed_save_no_current_harm_yet",
  "correct_save_failed_needed_retrieval",
  "correct_save_correct_needed_retrieval",
  "missed_save_later_needed",
  "wasteful_save_not_used",
  "wasteful_save_wrongly_used",
  "correct_abstention_from_saving"
]);

export const memoryFailureTypeSchema = z.enum([
  "irrelevant_retrieval",
  "missed_needed_retrieval",
  "missed_needed_write",
  "wasteful_save",
  "harmful_memory_activation",
  "stale_memory",
  "negative_transfer"
]);

export const memoryOpportunitySchema = z.object({
  opportunityId: z.string().min(1),
  summary: z.string().min(1),
  source: memorySourceSchema,
  scope: memoryScopeSchema,
  worthKeeping: z.boolean(),
  neededLater: z.boolean().default(false),
  relatedTurnIds: z.array(z.string().min(1)).default([])
});

export const memoryCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  turnId: z.string().min(1),
  expectedAction: z.enum(["retrieve", "skip_retrieval"]),
  relatedOpportunityIds: z.array(z.string().min(1)).default([]),
  rationale: z.string().min(1)
});

export const memoryEvaluationSpecSchema = z
  .object({
    memorySources: z.array(memorySourceSchema).min(1),
    memoryScope: memoryScopeSchema,
    memoryOpportunities: z.array(memoryOpportunitySchema).min(1),
    memoryCheckpoints: z.array(memoryCheckpointSchema).min(1),
    expectedMemoryState: expectedMemoryStateSchema,
    expectedMemoryImpact: expectedMemoryImpactSchema
  })
  .superRefine((value, context) => {
    const opportunityIds = new Set<string>();

    for (const opportunity of value.memoryOpportunities) {
      if (opportunityIds.has(opportunity.opportunityId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "memory opportunity IDs must be unique",
          path: ["memoryOpportunities"]
        });
      }

      opportunityIds.add(opportunity.opportunityId);
    }

    for (const checkpoint of value.memoryCheckpoints) {
      for (const opportunityId of checkpoint.relatedOpportunityIds) {
        if (!opportunityIds.has(opportunityId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown memory opportunity reference: ${opportunityId}`,
            path: ["memoryCheckpoints"]
          });
        }
      }
    }
  });

export type MemoryEvaluationSpec = z.infer<typeof memoryEvaluationSpecSchema>;

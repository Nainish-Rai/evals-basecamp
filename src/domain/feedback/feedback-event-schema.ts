import { z } from "zod";

export const feedbackSourceSchema = z.enum(["reviewer", "user", "system"]);

export const feedbackResolutionSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "partially_applied"
]);

export const feedbackEventSchema = z.object({
  feedbackId: z.string().min(1),
  turnId: z.string().min(1),
  source: feedbackSourceSchema,
  summary: z.string().min(1),
  instructions: z.array(z.string().min(1)).min(1),
  correctedFacts: z.array(z.string().min(1)).default([]),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  resolution: feedbackResolutionSchema.default("pending")
});

export type FeedbackEvent = z.infer<typeof feedbackEventSchema>;

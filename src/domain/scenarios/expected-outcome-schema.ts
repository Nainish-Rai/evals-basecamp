import { z } from "zod";

export const expectedOutcomeSchema = z.object({
  findingId: z.string().min(1),
  summary: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  requiredEvidenceRefs: z.array(z.string().min(1)).default([]),
  requiredPolicyRefs: z.array(z.string().min(1)).default([])
});

export type ExpectedOutcome = z.infer<typeof expectedOutcomeSchema>;

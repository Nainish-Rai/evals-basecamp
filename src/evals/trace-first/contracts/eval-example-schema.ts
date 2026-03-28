import { z } from "zod";

export const evalTaskSchema = z.object({
  text: z.string().min(1),
  images: z.array(z.string().min(1)).default([])
});

export const evalExampleSchema = z.object({
  example_id: z.string().min(1),
  variation_group_id: z.string().min(1),
  task_type: z.string().min(1),
  task: evalTaskSchema,
  instructions: z.string().min(1),
  workspace: z.array(z.string().min(1)).default([]),
  run_id: z.string().min(1).optional(),
  run_batch_id: z.string().min(1).optional()
});

export type EvalExample = z.infer<typeof evalExampleSchema>;

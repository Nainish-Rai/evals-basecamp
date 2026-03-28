import { z } from "zod";

import { evalExampleSchema } from "./eval-example-schema.js";

const traceScoreSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  comment: z.string().optional()
});

const traceSpanSchema = z.object({
  spanId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  name: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  scores: z.array(traceScoreSchema),
  errorMessage: z.string().nullable()
});

const traceEventSchema = z.object({
  eventId: z.string().min(1),
  parentSpanId: z.string().nullable(),
  name: z.string().min(1),
  recordedAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown())
});

export const traceExportSchema = z.object({
  traceId: z.string().nullable(),
  enabled: z.boolean(),
  traceName: z.string().nullable(),
  status: z.enum(["completed", "failed"]),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  scores: z.array(traceScoreSchema),
  spans: z.array(traceSpanSchema),
  events: z.array(traceEventSchema),
  vendorTraceIds: z.array(z.string().min(1))
});

export const runBundleSchema = z.object({
  bundleId: z.string().min(1),
  example: evalExampleSchema,
  mode: z.enum(["initial", "feedback_rerun"]),
  feedbackIds: z.array(z.string().min(1)).default([]),
  finalResponse: z.string().min(1),
  outputArtifacts: z.array(z.string().min(1)).default([]),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  }),
  agentMetadata: z.record(z.string(), z.unknown()).default({}),
  trace: traceExportSchema.nullable(),
  collectedAt: z.string().min(1),
  agentLabel: z.string().min(1).default("scenario-runner"),
  modelLabel: z.string().min(1).default("unknown")
});

export type RunBundle = z.infer<typeof runBundleSchema>;
export type TraceExportRecord = z.infer<typeof traceExportSchema>;

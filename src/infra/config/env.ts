import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import {
  isStrictlySmallerModelTier,
  modelTierSchema
} from "../../domain/agents/model-tier-schema.js";

loadDotEnv();

const booleanFlagSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalizedValue)) {
      return true;
    }

    if (["0", "false", "no", "off", ""].includes(normalizedValue)) {
      return false;
    }
  }

  return value;
}, z.boolean());

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    LANGFUSE_ENABLED: booleanFlagSchema.default(false),
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_BASE_URL: z.url().default("https://cloud.langfuse.com"),
    DEFAULT_MAIN_MODEL: z.string().min(1).default("openai:gpt-5.4"),
    DEFAULT_MAIN_MODEL_TIER: modelTierSchema.default("large"),
    DEFAULT_SUBAGENT_MODEL: z.string().min(1).default("openai:gpt-5.4-mini"),
    DEFAULT_SUBAGENT_MODEL_TIER: modelTierSchema.default("small")
  })
  .superRefine((value, context) => {
    if (value.LANGFUSE_ENABLED) {
      if (!value.LANGFUSE_PUBLIC_KEY) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "LANGFUSE_PUBLIC_KEY is required when LANGFUSE_ENABLED is true",
          path: ["LANGFUSE_PUBLIC_KEY"]
        });
      }

      if (!value.LANGFUSE_SECRET_KEY) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "LANGFUSE_SECRET_KEY is required when LANGFUSE_ENABLED is true",
          path: ["LANGFUSE_SECRET_KEY"]
        });
      }
    }

    if (
      !isStrictlySmallerModelTier(
        value.DEFAULT_SUBAGENT_MODEL_TIER,
        value.DEFAULT_MAIN_MODEL_TIER
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "DEFAULT_SUBAGENT_MODEL_TIER must be strictly smaller than DEFAULT_MAIN_MODEL_TIER",
        path: ["DEFAULT_SUBAGENT_MODEL_TIER"]
      });
    }
  });

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export function loadEnvironmentConfig(
  source: NodeJS.ProcessEnv = process.env
): EnvironmentConfig {
  return environmentSchema.parse(source);
}

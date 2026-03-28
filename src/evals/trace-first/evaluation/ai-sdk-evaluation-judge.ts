import { generateText, Output, stepCountIs, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import type { RunBundle } from "../contracts/run-bundle-schema.js";
import type {
  EvaluationJudge,
  MemoryJudgeOutput,
  RetryAttributionInput,
  RetryAttributionLabel
} from "./evaluation-judge.js";

const memoryStateSchema = z.enum([
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

const memoryJudgmentSchema = z.object({
  state: memoryStateSchema,
  rationale: z.string().min(1)
});

const retryAttributionSchema = z.object({
  label: z.enum([
    "system_prompt_vagueness",
    "tool_definition_ambiguity",
    "missing_context",
    "other"
  ])
});

export class AiSdkEvaluationJudge implements EvaluationJudge {
  private readonly provider;

  constructor(
    private readonly modelId: string,
    private readonly maxSteps: number,
    options: {
      baseURL?: string;
      apiKey?: string;
      apiKeyHeaderName?: string;
    } = {}
  ) {
    const extraHeaders =
      options.apiKey && options.apiKeyHeaderName
        ? {
            [options.apiKeyHeaderName]: options.apiKey
          }
        : undefined;

    this.provider = createOpenAI(
      {
        ...(options.baseURL
          ? {
              baseURL: options.baseURL
            }
          : {}),
        ...(options.apiKey
          ? {
              apiKey: options.apiKey
            }
          : {}),
        ...(extraHeaders
          ? {
              headers: extraHeaders
            }
          : {})
      }
    );
  }

  async judgeMemory(bundle: RunBundle): Promise<MemoryJudgeOutput> {
    const sharedMemoryPacket = {
      instruction: bundle.example.evaluationSpec.instruction,
      task: bundle.example.task,
      finalResponse: bundle.finalResponse,
      memoryCheckpoints: bundle.example.evaluationSpec.memoryCheckpoints,
      memoryWrites: readAgentMetadataArray(bundle.agentMetadata, "memoryWrites"),
      memoryWritesSkipped: readAgentMetadataArray(bundle.agentMetadata, "memoryWritesSkipped"),
      memoryReads: readAgentMetadataArray(bundle.agentMetadata, "memoryReads")
    };
    const { output } = await generateText({
      model: this.provider(this.modelId),
      system:
        "You are an evaluation judge. Always call the shared memory packet tool before deciding. Return exactly one of the allowed memory states.",
      prompt:
        "Judge shared memory utilization across the whole multi-agent trace. Assume all subagents share one memory. Decide the single best memory state and a concise rationale.",
      tools: {
        load_shared_memory_packet: tool({
          description: "Returns the structured shared-memory packet for the example.",
          inputSchema: z.object({}),
          execute: async () => sharedMemoryPacket
        })
      },
      toolChoice: {
        type: "tool",
        toolName: "load_shared_memory_packet"
      },
      stopWhen: stepCountIs(this.maxSteps),
      output: Output.object({
        schema: memoryJudgmentSchema
      })
    });

    return output;
  }

  async classifyRetryAttribution(
    input: RetryAttributionInput
  ): Promise<RetryAttributionLabel> {
    const { output } = await generateText({
      model: this.provider(this.modelId),
      system:
        "You are an evaluation judge. Always call the retry packet tool before deciding. Return exactly one retry attribution label.",
      prompt:
        "Classify the retry cause for this failed tool interaction into one label.",
      tools: {
        load_retry_packet: tool({
          description: "Returns the failed tool interaction that needs attribution.",
          inputSchema: z.object({}),
          execute: async () => input
        })
      },
      toolChoice: {
        type: "tool",
        toolName: "load_retry_packet"
      },
      stopWhen: stepCountIs(this.maxSteps),
      output: Output.object({
        schema: retryAttributionSchema
      })
    });

    return output.label;
  }
}

function readAgentMetadataArray(
  metadata: Record<string, unknown>,
  key: string
): unknown[] {
  const value = metadata[key];
  return Array.isArray(value) ? value : [];
}

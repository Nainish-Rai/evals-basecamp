import type { RunBundle } from "../contracts/run-bundle-schema.js";
import type {
  EvaluationJudge,
  MemoryJudgeOutput,
  RetryAttributionInput,
  RetryAttributionLabel
} from "./evaluation-judge.js";

export class HeuristicEvaluationJudge implements EvaluationJudge {
  async judgeMemory(bundle: RunBundle): Promise<MemoryJudgeOutput> {
    const metadata = bundle.agentMetadata as {
      memoryWrites?: Array<unknown>;
      memoryWritesSkipped?: Array<unknown>;
      memoryReads?: Array<{ usedInDecision?: boolean }>;
    };
    const writeCount = metadata.memoryWrites?.length ?? 0;
    const skippedWriteCount = metadata.memoryWritesSkipped?.length ?? 0;
    const readCount = metadata.memoryReads?.length ?? 0;
    const usedReadCount =
      metadata.memoryReads?.filter((memoryRead) => memoryRead.usedInDecision).length ?? 0;
    const expectedMemoryCount = bundle.example.evaluationSpec.memoryCheckpoints.length;

    if (writeCount > 0 && usedReadCount > 0) {
      return {
        state: "correct_save_correct_needed_retrieval",
        rationale: "The trace shows shared memory writes and later reads used in the decision."
      };
    }

    if (writeCount > 0 && readCount > 0) {
      return {
        state: "correct_save_irrelevant_retrieval",
        rationale: "The trace shows memory retrieval, but it was not used in the final decision."
      };
    }

    if (writeCount > 0 && expectedMemoryCount > 0) {
      return {
        state: "correct_save_failed_needed_retrieval",
        rationale: "The trace shows a memory write but no later needed retrieval."
      };
    }

    if (writeCount > 0) {
      return {
        state: "wasteful_save_not_used",
        rationale: "The trace shows a memory write without evidence of later use."
      };
    }

    if (expectedMemoryCount > 0) {
      return {
        state: "missed_save_later_needed",
        rationale: "The example expected later memory reuse, but no write was captured."
      };
    }

    if (skippedWriteCount > 0) {
      return {
        state: "correct_abstention_from_saving",
        rationale: "The trace shows abstention from low-value memory writes."
      };
    }

    return {
      state: "correct_abstention_from_saving",
      rationale: "No shared memory behavior was needed for this example."
    };
  }

  async classifyRetryAttribution(
    input: RetryAttributionInput
  ): Promise<RetryAttributionLabel> {
    const combinedText = `${input.inputSummary} ${input.outputSummary}`.toLowerCase();

    if (
      combinedText.includes("schema") ||
      combinedText.includes("parameter") ||
      combinedText.includes("invalid input")
    ) {
      return "tool_definition_ambiguity";
    }

    if (
      combinedText.includes("missing context") ||
      combinedText.includes("insufficient context") ||
      combinedText.includes("not enough context")
    ) {
      return "missing_context";
    }

    if (
      combinedText.includes("ambiguous tool framing") ||
      combinedText.includes("ambiguous") ||
      combinedText.includes("vague")
    ) {
      return "system_prompt_vagueness";
    }

    return "other";
  }
}

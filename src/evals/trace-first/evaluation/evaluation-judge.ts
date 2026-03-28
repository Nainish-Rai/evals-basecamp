import type { RunBundle } from "../contracts/run-bundle-schema.js";

export type RetryAttributionLabel =
  | "system_prompt_vagueness"
  | "tool_definition_ambiguity"
  | "missing_context"
  | "other";

export type MemoryJudgeOutput = {
  state:
    | "correct_save_correct_abstention_from_retrieval"
    | "correct_save_irrelevant_retrieval"
    | "missed_save_no_current_harm_yet"
    | "correct_save_failed_needed_retrieval"
    | "correct_save_correct_needed_retrieval"
    | "missed_save_later_needed"
    | "wasteful_save_not_used"
    | "wasteful_save_wrongly_used"
    | "correct_abstention_from_saving";
  rationale: string;
};

export type RetryAttributionInput = {
  toolName: string;
  inputSummary: string;
  outputSummary: string;
};

export interface EvaluationJudge {
  judgeMemory(bundle: RunBundle): Promise<MemoryJudgeOutput>;
  classifyRetryAttribution(input: RetryAttributionInput): Promise<RetryAttributionLabel>;
}

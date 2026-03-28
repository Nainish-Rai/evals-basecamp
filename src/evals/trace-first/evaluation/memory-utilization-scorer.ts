import type { RunBundle } from "../contracts/run-bundle-schema.js";
import type { EvaluationJudge } from "./evaluation-judge.js";

export type MemoryUtilizationResult = {
  score: number;
  state: string;
  passed: boolean;
  rationale: string;
};

const MEMORY_STATE_SCORES: Record<string, number> = {
  correct_save_correct_needed_retrieval: 1,
  correct_save_correct_abstention_from_retrieval: 0.9,
  correct_abstention_from_saving: 0.85,
  correct_save_irrelevant_retrieval: 0.6,
  missed_save_no_current_harm_yet: 0.55,
  correct_save_failed_needed_retrieval: 0.4,
  wasteful_save_not_used: 0.35,
  missed_save_later_needed: 0.25,
  wasteful_save_wrongly_used: 0
};

export class MemoryUtilizationScorer {
  constructor(private readonly judge: EvaluationJudge) {}

  async score(bundle: RunBundle): Promise<MemoryUtilizationResult> {
    const judgment = await this.judge.judgeMemory(bundle);
    const score = MEMORY_STATE_SCORES[judgment.state] ?? 0;

    return {
      score,
      state: judgment.state,
      passed: score >= 0.75,
      rationale: judgment.rationale
    };
  }
}

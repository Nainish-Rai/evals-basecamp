import type { EnvironmentConfig } from "../../../infra/config/env.js";
import { loadEnvironmentConfig } from "../../../infra/config/env.js";
import type { EvaluationJudge } from "./evaluation-judge.js";
import { AiSdkEvaluationJudge } from "./ai-sdk-evaluation-judge.js";

export function createEvaluationJudge(
  config: EnvironmentConfig = loadEnvironmentConfig()
): EvaluationJudge {
  if (!config.EVALUATOR_AGENT_ENABLED) {
    throw new Error(
      "Evaluator agent is not configured. Set EVALUATOR_AGENT_ENABLED=true and provide OPENAI_API_KEY, or inject an EvaluationJudge explicitly."
    );
  }

  return new AiSdkEvaluationJudge(
    config.EVALUATOR_AGENT_MODEL,
    config.EVALUATOR_AGENT_MAX_STEPS
  );
}

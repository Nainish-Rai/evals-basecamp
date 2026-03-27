import type { FeedbackEvent } from "../../domain/feedback/feedback-event-schema.js";
import type { Scenario } from "../../domain/scenarios/scenario-schema.js";

export type ScenarioExecutionMode = "initial" | "feedback_rerun";

export type ScenarioExecutionPlan = {
  mode: ScenarioExecutionMode;
  feedbackTurns: FeedbackEvent[];
};

export class FeedbackReplayEngine {
  planExecutions(scenario: Scenario): ScenarioExecutionPlan[] {
    const executionPlans: ScenarioExecutionPlan[] = [
      {
        mode: "initial",
        feedbackTurns: []
      }
    ];

    if (scenario.feedbackTurns.length > 0) {
      executionPlans.push({
        mode: "feedback_rerun",
        feedbackTurns: scenario.feedbackTurns
      });
    }

    return executionPlans;
  }
}

import type { Scenario } from "../../domain/scenarios/scenario-schema.js";

export type ScenarioRunRequest = {
  scenario: Scenario;
};

export class ScenarioRunner {
  run(request: ScenarioRunRequest): { scenarioId: string } {
    return {
      scenarioId: request.scenario.scenarioId
    };
  }
}

import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadScenarioDirectory,
  loadScenarioFile,
  loadSyntheticPackDirectory,
  loadSyntheticPackFile
} from "../../src/domain/scenarios/scenario-loader.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const testFixtureRoot = path.resolve(process.cwd(), "tests", "fixtures");

describe("scenario fixture loaders", () => {
  it("loads a scenario fixture from disk", async () => {
    const scenario = await loadScenarioFile(
      path.join(fixtureRoot, "scenarios", "compliance-001.json")
    );

    expect(scenario.scenarioId).toBe("scenario-compliance-001");
    expect(scenario.feedbackTurns).toHaveLength(1);
    expect(scenario.syntheticPackReferences).toHaveLength(1);
    expect(scenario.contextEvaluationSpec.contextScenarioType).toBe(
      "minimal_sufficient_context"
    );
    expect(scenario.memoryEvaluationSpec?.expectedMemoryImpact).toBe(
      "positive"
    );
  });

  it("loads all scenario fixtures from a directory", async () => {
    const scenarios = await loadScenarioDirectory(
      path.join(fixtureRoot, "scenarios")
    );

    expect(scenarios).toHaveLength(12);
    expect(new Set(scenarios.map((scenario) => scenario.taskFamily))).toEqual(
      new Set(["compliance", "governance", "investigation", "risk"])
    );
  });

  it("loads a synthetic pack fixture from disk", async () => {
    const pack = await loadSyntheticPackFile(
      path.join(fixtureRoot, "packs", "compliance-pack.json")
    );

    expect(pack.packId).toBe("pack-compliance-core-v2");
    expect(pack.entries).toHaveLength(3);
  });

  it("loads all synthetic pack fixtures from a directory", async () => {
    const packs = await loadSyntheticPackDirectory(
      path.join(fixtureRoot, "packs")
    );

    expect(packs).toHaveLength(4);
    expect(new Set(packs.map((pack) => pack.taskFamily))).toEqual(
      new Set(["compliance", "governance", "investigation", "risk"])
    );
  });

  it("fails fast when a fixture file violates the schema", async () => {
    await expect(
      loadScenarioFile(path.join(testFixtureRoot, "invalid-scenario.json"))
    ).rejects.toThrow(/failed validation/i);
  });
});

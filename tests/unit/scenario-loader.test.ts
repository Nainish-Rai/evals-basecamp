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
      path.join(fixtureRoot, "scenarios", "compliance-feedback-scenario.json")
    );

    expect(scenario.scenarioId).toBe("scenario-compliance-001");
    expect(scenario.feedbackTurns).toHaveLength(1);
    expect(scenario.syntheticPackReferences).toHaveLength(1);
    expect(scenario.memoryEvaluationSpec?.expectedMemoryImpact).toBe("positive");
  });

  it("loads all scenario fixtures from a directory", async () => {
    const scenarios = await loadScenarioDirectory(
      path.join(fixtureRoot, "scenarios")
    );

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.taskFamily).toBe("compliance");
  });

  it("loads a synthetic pack fixture from disk", async () => {
    const pack = await loadSyntheticPackFile(
      path.join(fixtureRoot, "packs", "compliance-pack.json")
    );

    expect(pack.packId).toBe("pack-compliance-core");
    expect(pack.entries).toHaveLength(1);
  });

  it("loads all synthetic pack fixtures from a directory", async () => {
    const packs = await loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"));

    expect(packs).toHaveLength(1);
    expect(packs[0]?.taskFamily).toBe("compliance");
  });

  it("fails fast when a fixture file violates the schema", async () => {
    await expect(
      loadScenarioFile(path.join(testFixtureRoot, "invalid-scenario.json"))
    ).rejects.toThrow(/failed validation/i);
  });
});

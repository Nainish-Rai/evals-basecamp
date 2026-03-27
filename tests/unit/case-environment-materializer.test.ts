import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../src/domain/scenarios/scenario-loader.js";
import { CaseEnvironmentMaterializer } from "../../src/runtime/materialization/case-environment-materializer.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("CaseEnvironmentMaterializer", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("materializes scenario assets, synthetic pack references, and variant manifests", async () => {
    const [scenario, syntheticPacks] = await Promise.all([
      loadScenarioFile(
        path.join(fixtureRoot, "scenarios", "governance-001.json")
      ),
      loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"))
    ]);
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-materializer-")
    );
    const syntheticPacksById = new Map(
      syntheticPacks.map((syntheticPack) => [
        syntheticPack.packId,
        syntheticPack
      ])
    );
    const materializer = new CaseEnvironmentMaterializer();

    cleanupPaths.push(outputRootPath);

    const environment = await materializer.materialize({
      scenario,
      syntheticPacksById,
      outputRootPath
    });

    expect(environment.workspacePath).toBe(
      path.join(outputRootPath, scenario.materialization.workspaceRoot)
    );
    expect(environment.registryEntries.length).toBeGreaterThan(0);
    expect(environment.surfacedContext.contextScenarioType).toBe(
      "wrong_context_retrieval"
    );
    expect(
      environment.registryEntries.some(
        (entry) => entry.sourceKind === "workspace_seed"
      )
    ).toBe(true);
    expect(
      environment.registryEntries.some(
        (entry) => entry.sourceKind === "context_variant"
      )
    ).toBe(true);
    expect(
      environment.registryEntries.some(
        (entry) => entry.sourceKind === "prompt_variant"
      )
    ).toBe(true);

    const workspaceSeedEntry = environment.registryEntries.find(
      (entry) =>
        entry.sourceKind === "workspace_seed" &&
        entry.sourceId === "governance-entry-01"
    );

    expect(workspaceSeedEntry).toBeDefined();

    if (!workspaceSeedEntry) {
      throw new Error(
        "Expected governance workspace seed entry to be materialized"
      );
    }

    const workspaceSeedContents = await readFile(
      workspaceSeedEntry.path,
      "utf8"
    );

    expect(workspaceSeedContents).toContain("Policy-to-control mapping gap");
    expect(workspaceSeedContents).toContain("third_party_risk_committee");
  });
});

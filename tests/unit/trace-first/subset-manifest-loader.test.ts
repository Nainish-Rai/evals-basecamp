import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadSubsetManifestById,
  loadSubsetManifestFile
} from "../../../src/evals/trace-first/subsets/subset-manifest-loader.js";

describe("subset-manifest-loader", () => {
  it("loads the built-in smoke subset by id", async () => {
    const manifest = await loadSubsetManifestById("smoke", process.cwd());

    expect(manifest.subsetId).toBe("smoke");
    expect(manifest.expectedScenarioIds).toContain("scenario-compliance-001");
  });

  it("loads the built-in release subset by file path", async () => {
    const manifest = await loadSubsetManifestFile(
      path.join(process.cwd(), "baselines", "subsets", "release.json")
    );

    expect(manifest.subsetId).toBe("release");
    expect(manifest.expectedScenarioIds).toHaveLength(12);
  });
});

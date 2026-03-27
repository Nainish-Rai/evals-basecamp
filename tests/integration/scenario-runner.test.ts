import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ScenarioRunner } from "../../src/runtime/runner/scenario-runner.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("ScenarioRunner", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("runs a real fixture end to end with the stub agent", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-")
    );
    const runner = new ScenarioRunner();

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "risk-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath
    });

    expect(result.scenarioId).toBe("scenario-risk-001");
    expect(result.executions).toHaveLength(2);
    expect(result.executions[0]).toMatchObject({
      mode: "initial",
      feedbackIds: []
    });
    expect(result.executions[1]).toMatchObject({
      mode: "feedback_rerun",
      feedbackIds: ["feedback-risk-001"]
    });
    expect(result.environment.rootPath).toBe(outputRootPath);
    expect(result.environment.workspacePath).toContain("workspace/case");
    expect(result.environment.registryEntries.length).toBeGreaterThan(0);
    expect(
      result.executions[0]?.agentResult.summary.includes("mode=initial")
    ).toBe(true);
    expect(
      result.executions[1]?.agentResult.summary.includes("mode=feedback_rerun")
    ).toBe(true);
    expect(result.traceContext.enabled).toBe(false);
    expect(result.traceContext.traceId).toBeNull();
  });
});

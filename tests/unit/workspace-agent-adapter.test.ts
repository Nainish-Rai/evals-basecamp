import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceAgentAdapter } from "../../src/evals/normalization/workspace-agent-adapter.js";
import { ScenarioRunner } from "../../src/runtime/runner/scenario-runner.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("WorkspaceAgentAdapter", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("normalizes a workspace-style run without tool-chain metadata", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-normalize-workspace-")
    );
    cleanupPaths.push(outputRootPath);

    const runResult = await new ScenarioRunner().runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "risk-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath
    });
    const adapter = new WorkspaceAgentAdapter();
    const execution = runResult.executions[1];

    if (!execution) {
      throw new Error("Expected a feedback rerun execution for risk-001");
    }

    const record = adapter.normalize(runResult, execution);

    expect(record.agentFamily).toBe("workspace");
    expect(record.turnId).toBe("turn-2");
    expect(record.feedbackInputs).toEqual(["feedback-risk-001"]);
    expect(record.toolSpecsCreated).toEqual([]);
    expect(record.toolCalls).toEqual([]);
    expect(record.budgetLedger).toEqual([]);
    expect(record.memoryFailureTypes).toEqual([
      "missed_needed_write",
      "missed_needed_retrieval"
    ]);
    expect(record.graphPath).toEqual([
      "planCaseWork",
      "curateWorkspace",
      "applyFeedback",
      "composeFinalAnswer"
    ]);
    expect(record.contextMetrics.promptTokens).toBe(610);
    expect(record.memoryNeededNow).toEqual(["memory-opportunity-risk-001"]);
  });
});

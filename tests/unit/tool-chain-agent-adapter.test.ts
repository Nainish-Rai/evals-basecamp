import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createToolChainScenarioAgent } from "../../src/agents/tool-chain/create-tool-chain-agent.js";
import { ToolChainAgentAdapter } from "../../src/evals/normalization/tool-chain-agent-adapter.js";
import { ScenarioRunner } from "../../src/runtime/runner/scenario-runner.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("ToolChainAgentAdapter", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("normalizes a tool-chain run into the canonical evaluation record", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-normalize-tool-chain-")
    );
    cleanupPaths.push(outputRootPath);

    const runResult = await new ScenarioRunner().runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "compliance-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath,
      agent: createToolChainScenarioAgent()
    });
    const adapter = new ToolChainAgentAdapter();
    const execution = runResult.executions[1];

    if (!execution) {
      throw new Error("Expected a feedback rerun execution for compliance-001");
    }

    const record = adapter.normalize(runResult, execution);

    expect(record.agentFamily).toBe("tool_chain");
    expect(record.turnId).toBe("turn-2");
    expect(record.feedbackInputs).toEqual(["feedback-compliance-001"]);
    expect(record.toolSpecsCreated).toHaveLength(2);
    expect(record.toolCalls).toHaveLength(2);
    expect(record.budgetLedger).toEqual([
      expect.objectContaining({
        budgetName: "tool_calls",
        consumed: 2
      })
    ]);
    expect(record.memoryWrites).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-compliance-001"
      })
    ]);
    expect(record.memoryReads).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-compliance-001",
        usedInDecision: true
      })
    ]);
    expect(record.memoryFailureTypes).toEqual([]);
    expect(record.memoryImpact).toBe("positive");
    expect(record.graphPath).toEqual([
      "planToolWork",
      "executeTool",
      "applyFeedback",
      "composeFinalAnswer"
    ]);
    expect(record.runId).toContain("feedback_rerun-turn-2");
  });
});

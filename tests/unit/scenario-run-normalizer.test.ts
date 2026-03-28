import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createToolChainScenarioAgent } from "../../src/agents/tool-chain/create-tool-chain-agent.js";
import { createWorkspaceScenarioAgent } from "../../src/agents/workspace/create-workspace-agent.js";
import { ScenarioRunNormalizer } from "../../src/evals/normalization/scenario-run-normalizer.js";
import { ScenarioRunner } from "../../src/runtime/runner/scenario-runner.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("ScenarioRunNormalizer", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("normalizes a tool-chain run with tool, budget, and feedback data", async () => {
    const runResult = await runScenario("compliance-001.json", createToolChainScenarioAgent());
    const records = new ScenarioRunNormalizer().normalize(runResult);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      agentFamily: "tool_chain",
      taskFamily: "compliance",
      turnId: "turn-1",
      groundedEvidenceRefs: ["artifact-compliance-001-policy"],
      graphPath: ["planToolWork", "executeTool", "applyFeedback", "composeFinalAnswer"]
    });
    expect(records[0]?.toolCalls).toHaveLength(2);
    expect(records[0]?.budgetLedger).toEqual([
      expect.objectContaining({
        budgetName: "tool_calls",
        allocated: 2,
        consumed: 2
      })
    ]);
    expect(records[1]).toMatchObject({
      turnId: "turn-2",
      feedbackInputs: ["feedback-compliance-001"],
      memoryRetrieved: ["memory-opportunity-compliance-001"],
      memoryNeededNow: ["memory-opportunity-compliance-001"],
      memoryUsedInDecision: ["memory-opportunity-compliance-001"],
      memoryFailureTypes: []
    });
    expect(records[1]?.memoryWrites).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-compliance-001",
        source: "user"
      })
    ]);
  });

  it("preserves failed and skipped tool calls in normalized tool-chain records", async () => {
    const runResult = await runScenario(
      "risk-002.json",
      createToolChainScenarioAgent({ toolCallBudget: 2 })
    );
    const records = new ScenarioRunNormalizer().normalize(runResult);

    expect(records).toHaveLength(2);
    expect(records[0]?.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "glossary_search",
          status: "failed",
          outputSummary: "Ambiguous tool framing caused a retry without introducing new facts."
        }),
        expect.objectContaining({
          toolName: "policy_search",
          status: "skipped",
          outputSummary: "Skipped because the tool-call budget was exhausted."
        })
      ])
    );
    expect(records[0]?.latencyMs).toBe(31);
    expect(records[1]?.turnId).toBe("turn-2");
  });

  it("normalizes real workspace runs with retrieval, subagent, and memory data", async () => {
    const runResult = await runScenario(
      "governance-001.json",
      createWorkspaceScenarioAgent()
    );
    const records = new ScenarioRunNormalizer().normalize(runResult);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      agentFamily: "workspace",
      taskFamily: "governance",
      toolCalls: [],
      budgetLedger: [],
      graphPath: [
        "planCaseWork",
        "curateWorkspace",
        "delegateSubagent",
        "applyFeedback",
        "composeFinalAnswer"
      ]
    });
    expect(records[0]?.retrievalEvents).toEqual([
      expect.objectContaining({
        selectedCount: expect.any(Number)
      })
    ]);
    expect(records[0]?.subagentEvents).toEqual([
      expect.objectContaining({
        modelTier: "medium"
      })
    ]);
    expect(records[0]?.filesystemArtifacts.length).toBeGreaterThan(0);
    expect(records[0]?.contextMetrics.workspaceArtifactTokens).toBeGreaterThan(0);
    expect(records[0]?.memoryFailureTypes).toEqual([]);
    expect(records[0]?.filesystemArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workspace/case/notes/governance-curated-note.md",
          kind: "workspace"
        })
      ])
    );
    expect(records[1]).toMatchObject({
      turnId: "turn-2",
      feedbackInputs: ["feedback-governance-001"]
    });
    expect(records[1]?.memoryFailureTypes).toEqual([]);
    expect(records[1]?.memoryRetrieved).toEqual([
      "memory-opportunity-governance-001"
    ]);
  });
});

async function runScenario(
  scenarioFileName: string,
  agent?: Parameters<ScenarioRunner["runFromFileSystem"]>[0]["agent"]
) {
  const outputRootPath = await mkdtemp(path.join(tmpdir(), "evals-basecamp-normalizer-"));
  cleanupPaths.push(outputRootPath);

  return new ScenarioRunner().runFromFileSystem({
    scenarioFilePath: path.join(fixtureRoot, "scenarios", scenarioFileName),
    syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
    outputRootPath,
    ...(agent ? { agent } : {})
  });
}

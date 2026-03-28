import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceScenarioAgent } from "../../src/agents/workspace/create-workspace-agent.js";
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

  it("normalizes a real workspace-agent run with retrieval and subagent metadata", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-normalize-workspace-")
    );
    cleanupPaths.push(outputRootPath);

    const runResult = await new ScenarioRunner().runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "governance-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath,
      agent: createWorkspaceScenarioAgent()
    });
    const adapter = new WorkspaceAgentAdapter();
    const execution = runResult.executions[1];

    if (!execution) {
      throw new Error("Expected a feedback rerun execution for governance-001");
    }

    const record = adapter.normalize(runResult, execution);

    expect(record.agentFamily).toBe("workspace");
    expect(record.turnId).toBe("turn-2");
    expect(record.feedbackInputs).toEqual(["feedback-governance-001"]);
    expect(record.retrievalEvents).toEqual([
      expect.objectContaining({
        selectedCount: expect.any(Number)
      })
    ]);
    expect(record.subagentEvents).toEqual([
      expect.objectContaining({
        modelTier: "medium",
        status: "completed"
      })
    ]);
    expect(record.memoryFailureTypes).toEqual([]);
    expect(record.graphPath).toEqual([
      "planCaseWork",
      "curateWorkspace",
      "delegateSubagent",
      "applyFeedback",
      "composeFinalAnswer"
    ]);
    expect(record.contextMetrics.promptTokens).toBe(500);
    expect(record.memoryNeededNow).toEqual(["memory-opportunity-governance-001"]);
    expect(record.memoryRetrieved).toEqual(["memory-opportunity-governance-001"]);
    expect(record.memoryUsedInDecision).toEqual(["memory-opportunity-governance-001"]);
    expect(record.trajectory).toEqual({
      requiredSteps: [
        "planCaseWork",
        "curateWorkspace",
        "delegateSubagent",
        "applyFeedback",
        "composeFinalAnswer"
      ],
      criticalTools: ["control_lookup", "workspace_write"],
      criticalDelegations: ["owner-mapping-subagent"],
      allowedStepFlexibility: "partial",
      allowAdditionalSteps: true
    });
    expect(record.filesystemArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workspace/case/notes/governance-curated-note.md",
          kind: "workspace"
        }),
        expect.objectContaining({
          path: "workspace/case/delegations/governance-subagent-output.md",
          kind: "workspace"
        })
      ])
    );
  });
});

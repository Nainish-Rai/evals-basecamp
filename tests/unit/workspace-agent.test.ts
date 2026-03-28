import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceScenarioAgent } from "../../src/agents/workspace/create-workspace-agent.js";
import type { WorkspaceAgentMetadata } from "../../src/agents/workspace/workspace-state.js";
import { ScenarioRunner } from "../../src/runtime/runner/scenario-runner.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("createWorkspaceScenarioAgent", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("runs four workspace scenarios with retrieval metadata and workspace outputs", async () => {
    const scenarioFileNames = [
      "governance-001.json",
      "investigation-002.json",
      "risk-001.json",
      "governance-003.json"
    ];
    const agent = createWorkspaceScenarioAgent();

    for (const scenarioFileName of scenarioFileNames) {
      const runResult = await runScenario(scenarioFileName, agent);

      expect(runResult.executions.length).toBeGreaterThan(0);

      for (const execution of runResult.executions) {
        const metadata = execution.agentResult.metadata as WorkspaceAgentMetadata;

        expect(metadata.graphPath).toContain("planCaseWork");
        expect(metadata.retrievalEvents.length).toBeGreaterThan(0);
        expect(metadata.contextMetrics.retrievedContextTokens).toBeGreaterThan(0);
        expect(
          execution.agentResult.outputArtifacts.some((artifactPath) =>
            artifactPath.includes("workspace/case")
          )
        ).toBe(true);
      }
    }
  });

  it("uses a strictly smaller-tier subagent when delegation is required", async () => {
    const runResult = await runScenario(
      "investigation-002.json",
      createWorkspaceScenarioAgent()
    );
    const metadata = runResult.executions[0]?.agentResult.metadata as WorkspaceAgentMetadata;

    expect(metadata.subagentEvents).toEqual([
      expect.objectContaining({
        modelTier: "medium",
        status: "completed"
      })
    ]);
    expect(metadata.contextMetrics.subagentCommunicationTokens).toBeGreaterThan(0);
  });

  it("rejects subagent tiers that are not strictly smaller than the main model tier", () => {
    expect(() =>
      createWorkspaceScenarioAgent({
        mainModelTier: "medium",
        subagentModelTier: "medium"
      })
    ).toThrow(
      "Workspace subagent model tier must be strictly smaller than the main model tier."
    );
  });
});

async function runScenario(
  scenarioFileName: string,
  agent: Parameters<ScenarioRunner["runFromFileSystem"]>[0]["agent"]
) {
  const outputRootPath = await mkdtemp(path.join(tmpdir(), "evals-basecamp-workspace-agent-"));
  cleanupPaths.push(outputRootPath);

  return new ScenarioRunner().runFromFileSystem({
    scenarioFilePath: path.join(fixtureRoot, "scenarios", scenarioFileName),
    syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
    outputRootPath,
    ...(agent ? { agent } : {})
  });
}

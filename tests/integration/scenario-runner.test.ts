import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createToolChainScenarioAgent } from "../../src/agents/tool-chain/create-tool-chain-agent.js";
import { createWorkspaceScenarioAgent } from "../../src/agents/workspace/create-workspace-agent.js";
import { LangfuseTracer } from "../../src/runtime/tracing/langfuse-tracer.js";
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
    expect(result.executions[0]?.agentResult.summary).toContain("Curated");
    expect(result.executions[1]?.agentResult.summary).toContain("Feedback applied");
    expect(result.traceContext.enabled).toBe(false);
    expect(result.traceContext.traceId).toBeNull();
  });

  it("runs a workspace governance fixture with retrieval, workspace, and subagent metadata", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-workspace-governance-")
    );
    const runner = new ScenarioRunner();

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "governance-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath
    });
    const initialMetadata = getWorkspaceMetadata(result.executions[0]?.agentResult.metadata);
    const rerunMetadata = getWorkspaceMetadata(result.executions[1]?.agentResult.metadata);

    expect(result.executions).toHaveLength(2);
    expect(initialMetadata.graphPath).toEqual([
      "planCaseWork",
      "curateWorkspace",
      "delegateSubagent",
      "applyFeedback",
      "composeFinalAnswer"
    ]);
    expect(initialMetadata.retrievalEvents).toEqual([
      expect.objectContaining({
        selectedCount: expect.any(Number)
      })
    ]);
    expect(initialMetadata.subagentEvents).toEqual([
      expect.objectContaining({
        modelTier: "medium",
        status: "completed"
      })
    ]);
    expect(result.executions[0]?.agentResult.outputArtifacts).toEqual([
      expect.stringContaining("workspace/case/governance-curated-note.md")
    ]);
    expect(rerunMetadata.memoryReads).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-governance-001",
        usedInDecision: true
      })
    ]);
  });

  it("runs a workspace investigation fixture with a delegated smaller-model subagent", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-workspace-investigation-")
    );
    const runner = new ScenarioRunner();

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "investigation-002.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath,
      agent: createWorkspaceScenarioAgent({
        mainModelTier: "large",
        subagentModelTier: "medium"
      })
    });
    const metadata = getWorkspaceMetadata(result.executions[0]?.agentResult.metadata);

    expect(result.executions).toHaveLength(1);
    expect(metadata.subagentEvents).toEqual([
      expect.objectContaining({
        taskSummary: "Review the linked-entity chart and return only the nominee-director delta."
      })
    ]);
    expect(metadata.contextMetrics.subagentCommunicationTokens).toBeGreaterThan(0);
  });

  it("runs a tool-chain compliance fixture with the real agent", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-tool-chain-compliance-")
    );
    const runner = new ScenarioRunner();

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "compliance-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath,
      agent: createToolChainScenarioAgent()
    });
    const initialMetadata = getToolChainMetadata(result.executions[0]?.agentResult.metadata);
    const rerunMetadata = getToolChainMetadata(result.executions[1]?.agentResult.metadata);

    expect(result.executions).toHaveLength(2);
    expect(initialMetadata).toMatchObject({
      graphPath: ["planToolWork", "executeTool", "applyFeedback", "composeFinalAnswer"]
    });
    expect(initialMetadata.toolSpecsCreated).toHaveLength(2);
    expect(initialMetadata.toolCalls).toHaveLength(2);
    expect(initialMetadata.budgetLedger).toEqual([
      expect.objectContaining({
        budgetName: "tool_calls",
        allocated: 2,
        consumed: 2
      })
    ]);
    expect(rerunMetadata.stateSnapshot.feedbackLedger).toEqual([
      expect.objectContaining({
        feedbackId: "feedback-compliance-001"
      })
    ]);
  });

  it("runs a tool-chain risk fixture with failure and budget metadata", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-tool-chain-risk-")
    );
    const runner = new ScenarioRunner();

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "risk-002.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath,
      agent: createToolChainScenarioAgent({ toolCallBudget: 2 })
    });
    const initialMetadata = getToolChainMetadata(result.executions[0]?.agentResult.metadata);

    expect(result.executions).toHaveLength(2);
    expect(initialMetadata.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "glossary_search",
          status: "failed"
        }),
        expect.objectContaining({
          toolName: "policy_search",
          status: "skipped"
        })
      ])
    );
    expect(initialMetadata.budgetLedger).toEqual([
      expect.objectContaining({
        budgetName: "tool_calls",
        allocated: 2,
        consumed: 2,
        remaining: 0
      })
    ]);
    expect(result.executions[1]?.agentResult.summary).toContain(
      "The retry came from ambiguous tool framing, not new evidence."
    );
  });

  it("captures nested tracing metadata when tracing is enabled", async () => {
    const outputRootPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-runner-trace-")
    );
    const runner = new ScenarioRunner(
      undefined,
      undefined,
      new LangfuseTracer({ enabled: true })
    );

    cleanupPaths.push(outputRootPath);

    const result = await runner.runFromFileSystem({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "risk-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputRootPath
    });

    expect(result.traceContext.enabled).toBe(true);
    expect(result.traceContext.traceId).toContain("trace-");
    expect(result.traceContext.spanCount).toBeGreaterThanOrEqual(7);
    expect(result.traceContext.scoreCount).toBe(1);
    expect(result.traceContext.status).toBe("completed");
  });
});

function getToolChainMetadata(metadata: unknown) {
  return metadata as {
    graphPath: string[];
    toolSpecsCreated: unknown[];
    toolCalls: Array<Record<string, unknown>>;
    budgetLedger: unknown[];
    stateSnapshot: {
      feedbackLedger: unknown[];
    };
  };
}

function getWorkspaceMetadata(metadata: unknown) {
  return metadata as {
    graphPath: string[];
    retrievalEvents: Array<Record<string, unknown>>;
    subagentEvents: Array<Record<string, unknown>>;
    memoryReads: Array<Record<string, unknown>>;
    contextMetrics: {
      subagentCommunicationTokens: number;
    };
  };
}

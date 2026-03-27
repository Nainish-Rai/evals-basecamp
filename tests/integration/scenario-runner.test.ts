import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createToolChainScenarioAgent } from "../../src/agents/tool-chain/create-tool-chain-agent.js";
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
    expect(
      result.executions[0]?.agentResult.summary.includes("mode=initial")
    ).toBe(true);
    expect(
      result.executions[1]?.agentResult.summary.includes("mode=feedback_rerun")
    ).toBe(true);
    expect(result.traceContext.enabled).toBe(false);
    expect(result.traceContext.traceId).toBeNull();
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
    expect(result.traceContext.spanCount).toBe(3);
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

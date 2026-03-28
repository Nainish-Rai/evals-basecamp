import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createToolChainScenarioAgent } from "../../../src/agents/tool-chain/create-tool-chain-agent.js";
import { TraceFirstScenarioCollector } from "../../../src/evals/trace-first/collection/trace-first-scenario-collector.js";
import { HeuristicEvaluationJudge } from "../../../src/evals/trace-first/evaluation/heuristic-evaluation-judge.js";
import { TraceFirstEvaluator } from "../../../src/evals/trace-first/evaluation/trace-first-evaluator.js";
import { StubScenarioAgent } from "../../../src/runtime/runner/stub-scenario-agent.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("TraceFirstScenarioCollector", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("collects run bundles from scenario fixtures and evaluates them", async () => {
    const outputDirectoryPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-trace-first-")
    );
    cleanupPaths.push(outputDirectoryPath);

    const collector = new TraceFirstScenarioCollector(
      undefined,
      (scenario) =>
        scenario.agentFamily === "tool_chain"
          ? createToolChainScenarioAgent()
          : new StubScenarioAgent(),
      undefined,
      true
    );
    const bundles = await collector.collect({
      scenarioFilePath: path.join(
        fixtureRoot,
        "scenarios",
        "compliance-001.json"
      ),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputDirectoryPath
    });
    const writtenBundleContents = JSON.parse(
      await readFile(
        path.join(
          outputDirectoryPath,
          "run-bundles",
          `${bundles[0]?.bundleId}.json`
        ),
        "utf8"
      )
    ) as { runId: string; trace: { spans: unknown[] } };
    const evaluation = await new TraceFirstEvaluator(
      new HeuristicEvaluationJudge()
    ).evaluate(bundles);

    expect(bundles).toHaveLength(2);
    expect(writtenBundleContents.runId.length).toBeGreaterThan(0);
    expect(writtenBundleContents.trace.spans.length).toBeGreaterThan(0);
    expect(evaluation.examples).toHaveLength(2);
    expect(evaluation.examples[1]).toMatchObject({
      runId: expect.any(String),
      exampleId: "scenario-compliance-001",
      memoryPassed: true
    });
    expect(evaluation.examples[1]?.contextScore).toBeGreaterThan(0);
    expect(evaluation.examples[0]?.metricResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricFamily: "domain_correctness"
        })
      ])
    );
    expect(evaluation.examples[1]?.metricResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricFamily: "memory_utilization"
        }),
        expect.objectContaining({
          metricFamily: "feedback_integration"
        })
      ])
    );
    expect(evaluation.peerEfficiency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "compliance"
        })
      ])
    );
  });
});

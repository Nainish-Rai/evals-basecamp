import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TraceFirstScenarioCollector } from "../../../src/evals/trace-first/collection/trace-first-scenario-collector.js";
import { HeuristicEvaluationJudge } from "../../../src/evals/trace-first/evaluation/heuristic-evaluation-judge.js";
import { TraceFirstEvaluator } from "../../../src/evals/trace-first/evaluation/trace-first-evaluator.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("TraceFirstScenarioCollector", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((cleanupPath) =>
        rm(cleanupPath, { recursive: true, force: true })
      )
    );
  });

  it("collects run bundles from scenario fixtures and evaluates them", async () => {
    const outputDirectoryPath = await mkdtemp(
      path.join(tmpdir(), "evals-basecamp-trace-first-")
    );
    cleanupPaths.push(outputDirectoryPath);

    const collector = new TraceFirstScenarioCollector();
    const bundles = await collector.collect({
      scenarioFilePath: path.join(fixtureRoot, "scenarios", "compliance-001.json"),
      syntheticPackDirectoryPath: path.join(fixtureRoot, "packs"),
      outputDirectoryPath
    });
    const writtenBundleContents = JSON.parse(
      await readFile(
        path.join(outputDirectoryPath, "run-bundles", `${bundles[0]?.bundleId}.json`),
        "utf8"
      )
    ) as { trace: { spans: unknown[] } };
    const evaluation = await new TraceFirstEvaluator(
      new HeuristicEvaluationJudge()
    ).evaluate(bundles);

    expect(bundles).toHaveLength(2);
    expect(writtenBundleContents.trace.spans.length).toBeGreaterThan(0);
    expect(evaluation.examples).toHaveLength(2);
    expect(evaluation.examples[1]).toMatchObject({
      exampleId: "scenario-compliance-001",
      memoryPassed: true
    });
    expect(evaluation.examples[1]?.contextScore).toBeGreaterThan(0);
    expect(evaluation.peerEfficiency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskType: "compliance"
        })
      ])
    );
  });
});

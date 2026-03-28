import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { TraceFirstScenarioCollector } from "../collection/trace-first-scenario-collector.js";
import type { MetricResult } from "../../contracts/metric-result-schema.js";
import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { createEvaluationJudge } from "../evaluation/create-evaluation-judge.js";
import { TraceFirstEvaluator } from "../evaluation/trace-first-evaluator.js";

async function main(): Promise<void> {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const bundleDirectoryPath = argumentsMap.get("--bundles");
  const outputDirectoryPath = argumentsMap.get("--output");

  if (!bundleDirectoryPath || !outputDirectoryPath) {
    throw new Error(
      "Usage: node dist/src/evals/trace-first/cli/evaluate-trace-first-cli.js --bundles <dir> --output <dir>"
    );
  }

  const collector = new TraceFirstScenarioCollector();
  const bundles = await collector.loadBundles(
    path.resolve(process.cwd(), bundleDirectoryPath)
  );
  const evaluator = new TraceFirstEvaluator(createEvaluationJudge());
  const evaluation = await evaluator.evaluate(bundles);
  const driftSummaries = evaluator.summarizeDrift(evaluation.examples);
  const scoredRunBundles = attachMetricResultsToBundles(bundles, evaluation.examples);
  const resolvedOutputDirectoryPath = path.resolve(
    process.cwd(),
    outputDirectoryPath
  );

  await mkdir(resolvedOutputDirectoryPath, { recursive: true });
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluated-examples.jsonl"),
    `${evaluation.examples.map((example) => JSON.stringify(example)).join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "metric-results.jsonl"),
    `${evaluation.examples
      .flatMap((example) =>
        example.metricResults.map((metricResult) =>
          JSON.stringify({
            bundleId: example.bundleId,
            exampleId: example.exampleId,
            variantGroupId: example.variantGroupId,
            runId: example.runId,
            mode: example.mode,
            metricResult
          })
        )
      )
      .join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "scored-run-bundles.jsonl"),
    `${scoredRunBundles.map((bundle) => JSON.stringify(bundle)).join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "peer-efficiency.json"),
    JSON.stringify(evaluation.peerEfficiency, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "metric-averages.json"),
    JSON.stringify(summarizeMetricAverages(evaluation.examples), null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "variant-group-drift.json"),
    JSON.stringify(driftSummaries, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluation-summary.json"),
    JSON.stringify(
      {
        evaluatedExampleCount: evaluation.examples.length,
        metricResultCount: evaluation.examples.reduce(
          (total, example) => total + example.metricResults.length,
          0
        ),
        scoredRunBundleCount: scoredRunBundles.length,
        peerGroupCount: evaluation.peerEfficiency.length,
        driftGroupCount: driftSummaries.length
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        evaluatedExampleCount: evaluation.examples.length,
        outputDirectoryPath: resolvedOutputDirectoryPath
      },
      null,
      2
    )
  );
}

function parseArguments(argumentsList: string[]): Map<string, string> {
  const argumentsMap = new Map<string, string>();

  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];

    if (!key || !value) {
      continue;
    }

    argumentsMap.set(key, value);
  }

  return argumentsMap;
}

function attachMetricResultsToBundles(
  bundles: RunBundle[],
  examples: EvaluatedExample[]
): RunBundle[] {
  const examplesByRunId = new Map(examples.map((example) => [example.runId, example]));

  return bundles.map((bundle) => {
    const example = examplesByRunId.get(bundle.runId);

    if (!example || bundle.trace === null) {
      return bundle;
    }

    return {
      ...bundle,
      trace: {
        ...bundle.trace,
        scores: [...bundle.trace.scores, ...toTraceScores(example.metricResults)]
      }
    };
  });
}

function toTraceScores(metricResults: MetricResult[]) {
  return metricResults.map((metricResult) => ({
    name: metricResult.metricId,
    value: metricResult.score,
    comment: metricResult.summary
  }));
}

function summarizeMetricAverages(examples: EvaluatedExample[]) {
  const metricGroups = new Map<string, MetricResult[]>();

  for (const example of examples) {
    for (const metricResult of example.metricResults) {
      const group = metricGroups.get(metricResult.metricFamily) ?? [];
      group.push(metricResult);
      metricGroups.set(metricResult.metricFamily, group);
    }
  }

  return {
    accuracyScoreAverage: round(average(examples.map((example) => example.accuracyScore))),
    domainCorrectnessScoreAverage: round(
      average(examples.map((example) => example.domainCorrectnessScore))
    ),
    feedbackIntegrationScoreAverage: round(
      average(examples.map((example) => example.feedbackIntegrationScore))
    ),
    memoryScoreAverage: round(average(examples.map((example) => example.memoryScore))),
    contextScoreAverage: round(average(examples.map((example) => example.contextScore))),
    metricFamilyAverages: [...metricGroups.entries()].map(([metricFamily, metricResults]) => ({
      metricFamily,
      averageScore: round(average(metricResults.map((metricResult) => metricResult.score))),
      passRate: round(
        average(metricResults.map((metricResult) => (metricResult.passed ? 1 : 0)))
      ),
      count: metricResults.length
    }))
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

await main();

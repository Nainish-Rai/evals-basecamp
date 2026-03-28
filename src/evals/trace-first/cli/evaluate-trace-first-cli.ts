import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { TraceFirstScenarioCollector } from "../collection/trace-first-scenario-collector.js";
import type { MetricResult } from "../../contracts/metric-result-schema.js";
import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import {
  baselineArtifactSchema,
  type BaselineArtifact
} from "../contracts/baseline-artifact-schema.js";
import { createEvaluationJudge } from "../evaluation/create-evaluation-judge.js";
import { TraceFirstEvaluator } from "../evaluation/trace-first-evaluator.js";
import {
  buildFeedbackRerunComparisonReport,
  summarizeFeedbackRerunComparisonReport
} from "../reporting/baseline-comparison-report.js";
import {
  buildHistoricalRegressionComparisonReport,
  evaluateHistoricalRegressionGate,
  summarizeHistoricalRegressionReport
} from "../reporting/historical-regression-report.js";
import {
  loadSubsetManifestById,
  loadSubsetManifestFile
} from "../subsets/subset-manifest-loader.js";
import type { SubsetManifest } from "../contracts/subset-manifest-schema.js";

async function main(): Promise<void> {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const bundleDirectoryPath = argumentsMap.get("--bundles");
  const outputDirectoryPath = argumentsMap.get("--output");
  const subsetId = argumentsMap.get("--subset") ?? null;
  const subsetManifestPath = argumentsMap.get("--subset-manifest") ?? null;
  const baselinePath = argumentsMap.get("--baseline") ?? null;
  const writeBaselinePath = argumentsMap.get("--write-baseline") ?? null;
  const sourceCommit = argumentsMap.get("--source-commit") ?? null;
  const notes = argumentsMap.get("--notes") ?? null;
  const failOnRegression = argumentsMap.has("--fail-on-regression");

  if (!bundleDirectoryPath || !outputDirectoryPath) {
    throw new Error(
      "Usage: node dist/src/evals/trace-first/cli/evaluate-trace-first-cli.js --bundles <dir> --output <dir>"
    );
  }

  if ((baselinePath || writeBaselinePath) && !subsetId && !subsetManifestPath) {
    throw new Error(
      "A subset manifest is required when writing or checking historical baselines. Pass --subset <id> or --subset-manifest <path>."
    );
  }

  const collector = new TraceFirstScenarioCollector();
  const bundles = await collector.loadBundles(
    path.resolve(process.cwd(), bundleDirectoryPath)
  );
  const evaluator = new TraceFirstEvaluator(createEvaluationJudge());
  const evaluation = await evaluator.evaluate(bundles);
  const subsetManifest = await resolveSubsetManifest({
    subsetId,
    subsetManifestPath
  });
  const reportingExamples = filterExamplesForSubset(
    evaluation.examples,
    subsetManifest
  );
  const reportingBundles = filterBundlesForSubset(bundles, subsetManifest);
  const driftSummaries = evaluator.summarizeDrift(reportingExamples);
  const feedbackRerunComparisons = buildFeedbackRerunComparisonReport(
    reportingBundles,
    reportingExamples
  );
  const feedbackRerunComparisonSummary =
    summarizeFeedbackRerunComparisonReport(feedbackRerunComparisons);
  const metricAverages = summarizeMetricAverages(reportingExamples);
  const scoredRunBundles = attachMetricResultsToBundles(
    reportingBundles,
    reportingExamples
  );
  const resolvedOutputDirectoryPath = path.resolve(
    process.cwd(),
    outputDirectoryPath
  );

  await mkdir(resolvedOutputDirectoryPath, { recursive: true });
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluated-examples.jsonl"),
    `${reportingExamples.map((example) => JSON.stringify(example)).join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "metric-results.jsonl"),
    `${reportingExamples
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
    JSON.stringify(metricAverages, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "variant-group-drift.json"),
    JSON.stringify(driftSummaries, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "feedback-rerun-comparisons.jsonl"),
    `${feedbackRerunComparisons.map((comparison) => JSON.stringify(comparison)).join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "feedback-rerun-comparison-summary.json"),
    JSON.stringify(feedbackRerunComparisonSummary, null, 2)
  );

  let historicalRegressionSummary:
    | ReturnType<typeof summarizeHistoricalRegressionReport>
    | null = null;
  let historicalRegressionGate:
    | ReturnType<typeof evaluateHistoricalRegressionGate>
    | null = null;

  if (writeBaselinePath && subsetManifest) {
    const baselineArtifact = createBaselineArtifact({
      subsetManifest,
      examples: reportingExamples,
      metricAverages,
      sourceCommit,
      notes
    });
    const resolvedBaselinePath = path.resolve(process.cwd(), writeBaselinePath);

    await mkdir(path.dirname(resolvedBaselinePath), { recursive: true });
    await writeFile(
      resolvedBaselinePath,
      JSON.stringify(baselineArtifact, null, 2)
    );
  }

  if (baselinePath) {
    if (!subsetManifest) {
      throw new Error("Subset manifest resolution failed for historical baseline comparison.");
    }

    const baselineArtifact = await loadBaselineArtifact(
      path.resolve(process.cwd(), baselinePath)
    );

    if (baselineArtifact.subset.subsetId !== subsetManifest.subsetId) {
      throw new Error(
        `Baseline subset ${baselineArtifact.subset.subsetId} does not match requested subset ${subsetManifest.subsetId}.`
      );
    }

    const historicalRegressionComparisons =
      buildHistoricalRegressionComparisonReport(
        reportingExamples,
        baselineArtifact,
        subsetManifest
      );
    historicalRegressionSummary = summarizeHistoricalRegressionReport(
      historicalRegressionComparisons,
      reportingExamples,
      baselineArtifact,
      subsetManifest
    );
    historicalRegressionGate = evaluateHistoricalRegressionGate(
      historicalRegressionComparisons,
      historicalRegressionSummary,
      subsetManifest
    );

    await writeFile(
      path.join(resolvedOutputDirectoryPath, "historical-regression-comparisons.jsonl"),
      `${historicalRegressionComparisons
        .map((comparison) => JSON.stringify(comparison))
        .join("\n")}\n`
    );
    await writeFile(
      path.join(resolvedOutputDirectoryPath, "historical-regression-summary.json"),
      JSON.stringify(historicalRegressionSummary, null, 2)
    );
    await writeFile(
      path.join(resolvedOutputDirectoryPath, "historical-regression-gate.json"),
      JSON.stringify(historicalRegressionGate, null, 2)
    );
  }

  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluation-summary.json"),
    JSON.stringify(
      {
        evaluatedExampleCount: reportingExamples.length,
        metricResultCount: reportingExamples.reduce(
          (total, example) => total + example.metricResults.length,
          0
        ),
        scoredRunBundleCount: scoredRunBundles.length,
        peerGroupCount: evaluation.peerEfficiency.length,
        driftGroupCount: driftSummaries.length,
        feedbackRerunComparisonCount: feedbackRerunComparisons.length,
        feedbackRerunSubsetCount:
          feedbackRerunComparisonSummary.benchmarkSubsetCount,
        subsetId: subsetManifest?.subsetId ?? null,
        historicalRegressionStatus: historicalRegressionGate?.status ?? null
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        evaluatedExampleCount: reportingExamples.length,
        outputDirectoryPath: resolvedOutputDirectoryPath
      },
      null,
      2
    )
  );

  if (
    failOnRegression &&
    historicalRegressionGate &&
    historicalRegressionGate.status !== "passed"
  ) {
    throw new Error(
      `Historical regression gate failed with status ${historicalRegressionGate.status}.`
    );
  }
}

function parseArguments(argumentsList: string[]): Map<string, string> {
  const argumentsMap = new Map<string, string>();

  for (let index = 0; index < argumentsList.length; index += 1) {
    const key = argumentsList[index];

    if (!key) {
      continue;
    }

    if (key.startsWith("--")) {
      const nextValue = argumentsList[index + 1];

      if (!nextValue || nextValue.startsWith("--")) {
        argumentsMap.set(key, "true");
        continue;
      }

      argumentsMap.set(key, nextValue);
      index += 1;
    }
  }

  return argumentsMap;
}

async function resolveSubsetManifest(options: {
  subsetId: string | null;
  subsetManifestPath: string | null;
}): Promise<SubsetManifest | null> {
  if (options.subsetManifestPath) {
    return loadSubsetManifestFile(
      path.resolve(process.cwd(), options.subsetManifestPath)
    );
  }

  if (options.subsetId) {
    return loadSubsetManifestById(options.subsetId, process.cwd());
  }

  return null;
}

async function loadBaselineArtifact(filePath: string): Promise<BaselineArtifact> {
  return baselineArtifactSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")) as unknown
  );
}

function createBaselineArtifact(options: {
  subsetManifest: SubsetManifest;
  examples: EvaluatedExample[];
  metricAverages: ReturnType<typeof summarizeMetricAverages>;
  sourceCommit: string | null;
  notes: string | null;
}): BaselineArtifact {
  return baselineArtifactSchema.parse({
    artifactVersion: 1,
    subset: options.subsetManifest,
    createdAt: new Date().toISOString(),
    sourceCommit: options.sourceCommit,
    notes: options.notes,
    evaluationSummary: {
      evaluatedExampleCount: options.examples.length,
      metricResultCount: options.examples.reduce(
        (total, example) => total + example.metricResults.length,
        0
      )
    },
    metricAverages: options.metricAverages,
    examples: options.examples
  });
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

function filterExamplesForSubset(
  examples: EvaluatedExample[],
  subsetManifest: SubsetManifest | null
): EvaluatedExample[] {
  if (!subsetManifest) {
    return examples;
  }

  const expectedScenarioIds = new Set(subsetManifest.expectedScenarioIds);

  return examples.filter((example) => expectedScenarioIds.has(example.exampleId));
}

function filterBundlesForSubset(
  bundles: RunBundle[],
  subsetManifest: SubsetManifest | null
): RunBundle[] {
  if (!subsetManifest) {
    return bundles;
  }

  const expectedScenarioIds = new Set(subsetManifest.expectedScenarioIds);

  return bundles.filter((bundle) => expectedScenarioIds.has(bundle.example.exampleId));
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

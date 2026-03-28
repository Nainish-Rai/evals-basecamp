import {
  historicalRegressionComparisonRecordSchema,
  type HistoricalRegressionComparisonRecord
} from "../../contracts/historical-regression-record.js";
import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { BaselineArtifact } from "../contracts/baseline-artifact-schema.js";
import type { SubsetManifest } from "../contracts/subset-manifest-schema.js";

type ExampleMetricDelta = HistoricalRegressionComparisonRecord["deltas"];

export type HistoricalRegressionSummary = {
  subsetId: string;
  expectedScenarioCount: number;
  currentScenarioCount: number;
  baselineScenarioCount: number;
  comparableExampleCount: number;
  currentExampleCount: number;
  baselineExampleCount: number;
  comparableExampleRate: number;
  missingCurrentScenarioIds: string[];
  missingBaselineScenarioIds: string[];
  averageDomainCorrectnessDelta: number | null;
  averageTrajectoryDelta: number | null;
  averageContextDelta: number | null;
  averageMemoryDelta: number | null;
  averageResponseQualityDelta: number | null;
  stableCount: number;
  improvedCount: number;
  regressedCount: number;
  mixedCount: number;
};

export type HistoricalRegressionGate = {
  subsetId: string;
  status: "passed" | "failed" | "configuration_error";
  violations: string[];
};

export function buildHistoricalRegressionComparisonReport(
  currentExamples: EvaluatedExample[],
  baselineArtifact: BaselineArtifact,
  subset: SubsetManifest
): HistoricalRegressionComparisonRecord[] {
  const baselineByKey = new Map(
    baselineArtifact.examples.map((example) => [buildComparisonKey(example), example])
  );

  return currentExamples.flatMap((currentExample) => {
    const baselineExample = baselineByKey.get(buildComparisonKey(currentExample));

    if (!baselineExample) {
      return [];
    }

    return [
      historicalRegressionComparisonRecordSchema.parse({
        comparisonKey: buildComparisonKey(currentExample),
        subsetId: subset.subsetId,
        comparisonStatus: classifyComparison(buildMetricDeltas(currentExample, baselineExample)),
        current: buildMetricSnapshot(currentExample),
        baseline: buildMetricSnapshot(baselineExample),
        deltas: buildMetricDeltas(currentExample, baselineExample),
        evidenceRefs: collectEvidenceRefs(currentExample, baselineExample)
      })
    ];
  });
}

export function summarizeHistoricalRegressionReport(
  comparisons: HistoricalRegressionComparisonRecord[],
  currentExamples: EvaluatedExample[],
  baselineArtifact: BaselineArtifact,
  subset: SubsetManifest
): HistoricalRegressionSummary {
  const currentScenarioIds = uniqueStrings(currentExamples.map((example) => example.exampleId));
  const baselineScenarioIds = uniqueStrings(
    baselineArtifact.examples.map((example) => example.exampleId)
  );
  const missingCurrentScenarioIds = subset.expectedScenarioIds.filter(
    (scenarioId) => !currentScenarioIds.includes(scenarioId)
  );
  const missingBaselineScenarioIds = subset.expectedScenarioIds.filter(
    (scenarioId) => !baselineScenarioIds.includes(scenarioId)
  );

  return {
    subsetId: subset.subsetId,
    expectedScenarioCount: subset.expectedScenarioIds.length,
    currentScenarioCount: currentScenarioIds.length,
    baselineScenarioCount: baselineScenarioIds.length,
    comparableExampleCount: comparisons.length,
    currentExampleCount: currentExamples.length,
    baselineExampleCount: baselineArtifact.examples.length,
    comparableExampleRate: round(
      ratio(comparisons.length, Math.max(currentExamples.length, baselineArtifact.examples.length))
    ),
    missingCurrentScenarioIds,
    missingBaselineScenarioIds,
    averageDomainCorrectnessDelta: averageDelta(
      comparisons,
      "domainCorrectnessScoreDelta"
    ),
    averageTrajectoryDelta: averageDelta(comparisons, "trajectoryScoreDelta"),
    averageContextDelta: averageDelta(comparisons, "contextScoreDelta"),
    averageMemoryDelta: averageDelta(comparisons, "memoryScoreDelta"),
    averageResponseQualityDelta: averageNullable(
      comparisons.map((comparison) => comparison.deltas.responseQualityScoreDelta)
    ),
    stableCount: comparisons.filter((comparison) => comparison.comparisonStatus === "stable").length,
    improvedCount: comparisons.filter((comparison) => comparison.comparisonStatus === "improved").length,
    regressedCount: comparisons.filter((comparison) => comparison.comparisonStatus === "regressed").length,
    mixedCount: comparisons.filter((comparison) => comparison.comparisonStatus === "mixed").length
  };
}

export function evaluateHistoricalRegressionGate(
  comparisons: HistoricalRegressionComparisonRecord[],
  summary: HistoricalRegressionSummary,
  subset: SubsetManifest
): HistoricalRegressionGate {
  const thresholds = subset.regressionThresholds;
  const violations: string[] = [];

  if (summary.missingCurrentScenarioIds.length > 0) {
    violations.push(
      `Current run is missing expected scenarios: ${summary.missingCurrentScenarioIds.join(", ")}`
    );
  }

  if (summary.missingBaselineScenarioIds.length > 0) {
    violations.push(
      `Baseline is missing expected scenarios: ${summary.missingBaselineScenarioIds.join(", ")}`
    );
  }

  if (summary.comparableExampleCount === 0) {
    violations.push("No comparable examples were found between current results and the baseline.");
  }

  if (summary.comparableExampleRate < thresholds.minComparableExampleRate) {
    violations.push(
      `Comparable example rate ${summary.comparableExampleRate} is below ${thresholds.minComparableExampleRate}.`
    );
  }

  checkMeanDrop(
    summary.averageDomainCorrectnessDelta,
    thresholds.maxDomainCorrectnessMeanDrop,
    "domain correctness",
    violations
  );
  checkMeanDrop(
    summary.averageTrajectoryDelta,
    thresholds.maxTrajectoryMeanDrop,
    "trajectory",
    violations
  );
  checkMeanDrop(
    summary.averageContextDelta,
    thresholds.maxContextMeanDrop,
    "context",
    violations
  );
  checkMeanDrop(
    summary.averageMemoryDelta,
    thresholds.maxMemoryMeanDrop,
    "memory",
    violations
  );
  checkMeanDrop(
    summary.averageResponseQualityDelta,
    thresholds.maxResponseQualityMeanDrop,
    "response quality",
    violations
  );

  const perExampleViolations = comparisons.flatMap((comparison) =>
    collectPerExampleViolations(comparison, thresholds.maxPerExampleDrop)
  );
  violations.push(...perExampleViolations);

  const configurationError = violations.some(
    (violation) =>
      violation.startsWith("Current run is missing") ||
      violation.startsWith("Baseline is missing") ||
      violation.startsWith("No comparable examples") ||
      violation.startsWith("Comparable example rate")
  );

  return {
    subsetId: subset.subsetId,
    status:
      violations.length === 0
        ? "passed"
        : configurationError
          ? "configuration_error"
          : "failed",
    violations
  };
}

function collectPerExampleViolations(
  comparison: HistoricalRegressionComparisonRecord,
  maxPerExampleDrop: number
): string[] {
  const deltas: Array<[string, number | null]> = [
    ["domain correctness", comparison.deltas.domainCorrectnessScoreDelta],
    ["trajectory", comparison.deltas.trajectoryScoreDelta],
    ["context", comparison.deltas.contextScoreDelta],
    ["memory", comparison.deltas.memoryScoreDelta],
    ["response quality", comparison.deltas.responseQualityScoreDelta]
  ];

  return deltas.flatMap(([label, delta]) => {
    if (delta === null || delta >= -maxPerExampleDrop) {
      return [];
    }

    return [
      `Example ${comparison.current.exampleId} ${comparison.current.mode} regressed on ${label} by ${round(delta)}.`
    ];
  });
}

function checkMeanDrop(
  averageDeltaValue: number | null,
  maxAllowedDrop: number,
  metricLabel: string,
  violations: string[]
): void {
  if (averageDeltaValue === null || averageDeltaValue >= -maxAllowedDrop) {
    return;
  }

  violations.push(
    `Average ${metricLabel} delta ${averageDeltaValue} is below -${maxAllowedDrop}.`
  );
}

function buildMetricSnapshot(example: EvaluatedExample) {
  return {
    exampleId: example.exampleId,
    variantGroupId: example.variantGroupId,
    runId: example.runId,
    agentLabel: example.agentLabel,
    modelLabel: example.modelLabel,
    mode: example.mode,
    domainCorrectnessScore: example.domainCorrectnessScore,
    trajectoryScore: example.trajectoryScore,
    contextScore: example.contextScore,
    memoryScore: example.memoryScore,
    responseQualityScore: readMetricScore(example, "response_quality_drift")
  };
}

function buildMetricDeltas(
  currentExample: EvaluatedExample,
  baselineExample: EvaluatedExample
): ExampleMetricDelta {
  const currentResponseQuality = readMetricScore(
    currentExample,
    "response_quality_drift"
  );
  const baselineResponseQuality = readMetricScore(
    baselineExample,
    "response_quality_drift"
  );

  return {
    domainCorrectnessScoreDelta: round(
      currentExample.domainCorrectnessScore - baselineExample.domainCorrectnessScore
    ),
    trajectoryScoreDelta: round(
      currentExample.trajectoryScore - baselineExample.trajectoryScore
    ),
    contextScoreDelta: round(currentExample.contextScore - baselineExample.contextScore),
    memoryScoreDelta: round(currentExample.memoryScore - baselineExample.memoryScore),
    responseQualityScoreDelta:
      currentResponseQuality === null || baselineResponseQuality === null
        ? null
        : round(currentResponseQuality - baselineResponseQuality)
  };
}

function classifyComparison(
  deltas: ExampleMetricDelta
): HistoricalRegressionComparisonRecord["comparisonStatus"] {
  const values = [
    deltas.domainCorrectnessScoreDelta,
    deltas.trajectoryScoreDelta,
    deltas.contextScoreDelta,
    deltas.memoryScoreDelta,
    ...(deltas.responseQualityScoreDelta === null
      ? []
      : [deltas.responseQualityScoreDelta])
  ];
  const positiveCount = values.filter((value) => value > 0).length;
  const negativeCount = values.filter((value) => value < 0).length;

  if (positiveCount === 0 && negativeCount === 0) {
    return "stable";
  }

  if (positiveCount > 0 && negativeCount === 0) {
    return "improved";
  }

  if (negativeCount > 0 && positiveCount === 0) {
    return "regressed";
  }

  return "mixed";
}

function buildComparisonKey(example: EvaluatedExample): string {
  return [
    example.exampleId,
    example.variantGroupId,
    example.mode,
    example.agentLabel,
    example.modelLabel
  ].join("::");
}

function readMetricScore(
  example: EvaluatedExample,
  metricFamily: string
): number | null {
  const metric = example.metricResults.find(
    (metricResult) => metricResult.metricFamily === metricFamily
  );

  return metric ? metric.score : null;
}

function collectEvidenceRefs(
  currentExample: EvaluatedExample,
  baselineExample: EvaluatedExample
): string[] {
  return uniqueStrings([
    ...currentExample.metricResults.flatMap((metricResult) => metricResult.evidenceRefs),
    ...baselineExample.metricResults.flatMap((metricResult) => metricResult.evidenceRefs)
  ]);
}

function averageDelta(
  comparisons: HistoricalRegressionComparisonRecord[],
  key: keyof ExampleMetricDelta
): number | null {
  const values = comparisons
    .map((comparison) => comparison.deltas[key])
    .filter((value): value is number => typeof value === "number");

  return values.length === 0 ? null : round(mean(values));
}

function averageNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value !== null);
  return filtered.length === 0 ? null : round(mean(filtered));
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function round(value: number): number {
  return Number(Math.max(-1, Math.min(1, value)).toFixed(4));
}

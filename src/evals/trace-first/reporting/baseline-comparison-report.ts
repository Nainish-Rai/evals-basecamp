import type { RunBundle } from "../contracts/run-bundle-schema.js";
import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import {
  baselineComparisonRecordSchema,
  type BaselineComparisonRecord
} from "../../contracts/baseline-comparison-record.js";

type ComparisonPair = {
  current: RunBundle;
  baseline: RunBundle;
  currentExample: EvaluatedExample;
  baselineExample: EvaluatedExample;
};

export type BaselineComparisonReportSummary = {
  comparisonCount: number;
  benchmarkSubsetCount: number;
  stableCount: number;
  improvedCount: number;
  regressedCount: number;
  mixedCount: number;
  averageAccuracyDelta: number;
  averageDomainCorrectnessDelta: number;
  averageFeedbackIntegrationDelta: number;
  averageMemoryDelta: number;
  averageTrajectoryDelta: number;
  averageContextDelta: number;
  averageResponseQualityDelta: number | null;
};

export function buildBaselineComparisonReport(
  bundles: RunBundle[],
  examples: EvaluatedExample[]
): BaselineComparisonRecord[] {
  const examplesByRunId = new Map(examples.map((example) => [example.runId, example]));
  const pairs = collectComparisonPairs(bundles, examplesByRunId);

  return pairs.map((pair) => {
    const deltas = buildMetricDeltas(pair.currentExample, pair.baselineExample);

    return baselineComparisonRecordSchema.parse({
      comparisonId: `${pair.current.runId}::${pair.baseline.runId}`,
      benchmarkSubset: pair.current.example.variantGroupId,
      baselineComparisonMode:
        pair.current.example.evaluationSpec.baselineComparisonMode,
      variantGroupId: pair.current.example.variantGroupId,
      taskFamily: pair.current.example.taskType,
      agentFamily: pair.current.agentLabel,
      comparisonStatus: classifyComparison(deltas),
      current: buildMetricSnapshot(pair.current, pair.currentExample),
      baseline: buildMetricSnapshot(pair.baseline, pair.baselineExample),
      deltas,
      driftClassification: readDriftClassification(pair.currentExample),
      pairMetricFamilies: collectMetricFamilies(pair.currentExample, pair.baselineExample),
      evidenceRefs: collectEvidenceRefs(pair.currentExample, pair.baselineExample)
    });
  });
}

export function summarizeBaselineComparisonReport(
  records: BaselineComparisonRecord[]
): BaselineComparisonReportSummary {
  return {
    comparisonCount: records.length,
    benchmarkSubsetCount: new Set(records.map((record) => record.benchmarkSubset)).size,
    stableCount: records.filter((record) => record.comparisonStatus === "stable").length,
    improvedCount: records.filter((record) => record.comparisonStatus === "improved").length,
    regressedCount: records.filter((record) => record.comparisonStatus === "regressed").length,
    mixedCount: records.filter((record) => record.comparisonStatus === "mixed").length,
    averageAccuracyDelta: round(average(records.map((record) => record.deltas.accuracyScoreDelta))),
    averageDomainCorrectnessDelta: round(
      average(records.map((record) => record.deltas.domainCorrectnessScoreDelta))
    ),
    averageFeedbackIntegrationDelta: round(
      average(records.map((record) => record.deltas.feedbackIntegrationScoreDelta))
    ),
    averageMemoryDelta: round(average(records.map((record) => record.deltas.memoryScoreDelta))),
    averageTrajectoryDelta: round(
      average(records.map((record) => record.deltas.trajectoryScoreDelta))
    ),
    averageContextDelta: round(average(records.map((record) => record.deltas.contextScoreDelta))),
    averageResponseQualityDelta: roundNullable(
      averageNullable(records.map((record) => record.deltas.responseQualityScoreDelta))
    )
  };
}

function collectComparisonPairs(
  bundles: RunBundle[],
  examplesByRunId: Map<string, EvaluatedExample>
): ComparisonPair[] {
  const pairs: ComparisonPair[] = [];
  const byVariantGroup = new Map<string, RunBundle[]>();

  for (const bundle of bundles) {
    if (bundle.example.evaluationSpec.baselineComparisonMode !== "baseline_relative_comparison") {
      continue;
    }

    const group = byVariantGroup.get(bundle.example.variantGroupId) ?? [];
    group.push(bundle);
    byVariantGroup.set(bundle.example.variantGroupId, group);
  }

  for (const group of byVariantGroup.values()) {
    const baselineBundle = group.find((bundle) => bundle.mode === "initial");
    if (!baselineBundle) {
      continue;
    }

    const baselineExample = examplesByRunId.get(baselineBundle.runId);
    if (!baselineExample) {
      continue;
    }

    for (const currentBundle of group.filter((bundle) => bundle.mode === "feedback_rerun")) {
      const currentExample = examplesByRunId.get(currentBundle.runId);
      if (!currentExample) {
        continue;
      }

      pairs.push({
        current: currentBundle,
        baseline: baselineBundle,
        currentExample,
        baselineExample
      });
    }
  }

  return pairs;
}

function buildMetricSnapshot(bundle: RunBundle, example: EvaluatedExample) {
  return {
    bundleId: bundle.bundleId,
    exampleId: bundle.example.exampleId,
    runId: bundle.runId,
    mode: bundle.mode,
    accuracyScore: example.accuracyScore,
    domainCorrectnessScore: example.domainCorrectnessScore,
    feedbackIntegrationScore: example.feedbackIntegrationScore,
    memoryScore: example.memoryScore,
    trajectoryScore: example.trajectoryScore,
    contextScore: example.contextScore,
    responseQualityScore: readMetricScore(example, "response_quality_drift")
  };
}

function buildMetricDeltas(
  currentExample: EvaluatedExample,
  baselineExample: EvaluatedExample
) {
  const currentResponseQualityScore = readMetricScore(
    currentExample,
    "response_quality_drift"
  );
  const baselineResponseQualityScore = readMetricScore(
    baselineExample,
    "response_quality_drift"
  );

  return {
    accuracyScoreDelta: roundDelta(currentExample.accuracyScore - baselineExample.accuracyScore),
    domainCorrectnessScoreDelta: roundDelta(
      currentExample.domainCorrectnessScore - baselineExample.domainCorrectnessScore
    ),
    feedbackIntegrationScoreDelta: roundDelta(
      currentExample.feedbackIntegrationScore - baselineExample.feedbackIntegrationScore
    ),
    memoryScoreDelta: roundDelta(currentExample.memoryScore - baselineExample.memoryScore),
    trajectoryScoreDelta: roundDelta(currentExample.trajectoryScore - baselineExample.trajectoryScore),
    contextScoreDelta: roundDelta(currentExample.contextScore - baselineExample.contextScore),
    responseQualityScoreDelta:
      currentResponseQualityScore === null || baselineResponseQualityScore === null
      ? null
      : roundDelta(currentResponseQualityScore - baselineResponseQualityScore)
  };
}

function readDriftClassification(example: EvaluatedExample): BaselineComparisonRecord["driftClassification"] {
  const metric = example.metricResults.find(
    (metricResult) => metricResult.metricFamily === "response_quality_drift"
  );
  const classification = metric?.details.classification;

  if (
    classification === "quality_preserving_variation" ||
    classification === "outcome_only_drift" ||
    classification === "trajectory_only_drift" ||
    classification === "combined_drift"
  ) {
    return classification;
  }

  return "unclassified";
}

function collectMetricFamilies(
  currentExample: EvaluatedExample,
  baselineExample: EvaluatedExample
): string[] {
  return [
    ...new Set(
      [
        ...currentExample.metricResults.map((metricResult) => metricResult.metricFamily),
        ...baselineExample.metricResults.map((metricResult) => metricResult.metricFamily)
      ]
    )
  ];
}

function collectEvidenceRefs(
  currentExample: EvaluatedExample,
  baselineExample: EvaluatedExample
): string[] {
  return [
    ...new Set(
      [
        ...currentExample.metricResults.flatMap((metricResult) => metricResult.evidenceRefs),
        ...baselineExample.metricResults.flatMap((metricResult) => metricResult.evidenceRefs)
      ].filter((evidenceRef) => evidenceRef.length > 0)
    )
  ];
}

function classifyComparison(
  deltas: ReturnType<typeof buildMetricDeltas>
): BaselineComparisonRecord["comparisonStatus"] {
  const values = [
    deltas.accuracyScoreDelta,
    deltas.domainCorrectnessScoreDelta,
    deltas.feedbackIntegrationScoreDelta,
    deltas.memoryScoreDelta,
    deltas.trajectoryScoreDelta,
    deltas.contextScoreDelta,
    ...(deltas.responseQualityScoreDelta === null ? [] : [deltas.responseQualityScoreDelta])
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

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value !== null);
  if (filtered.length === 0) {
    return null;
  }

  return average(filtered);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : round(value);
}

function roundDelta(value: number): number {
  return Number(Math.max(-1, Math.min(1, value)).toFixed(4));
}

function readMetricScore(example: EvaluatedExample, metricFamily: string): number | null {
  const metric = example.metricResults.find(
    (metricResult) => metricResult.metricFamily === metricFamily
  );

  return metric ? metric.score : null;
}

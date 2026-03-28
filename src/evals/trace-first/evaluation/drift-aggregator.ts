import { evaluatedExampleSchema, type DriftSummary, type EvaluatedExample } from "../contracts/evaluated-example-schema.js";

const DRIFT_CLASSIFICATION_KEYS = {
  quality_preserving_variation: "qualityPreservingVariation",
  outcome_only_drift: "outcomeOnlyDrift",
  trajectory_only_drift: "trajectoryOnlyDrift",
  combined_drift: "combinedDrift"
} as const;

export class DriftAggregator {
  attach(examples: EvaluatedExample[]): EvaluatedExample[] {
    const byVariantGroup = new Map<string, EvaluatedExample[]>();

    for (const example of examples) {
      const group = byVariantGroup.get(example.variantGroupId) ?? [];
      group.push(example);
      byVariantGroup.set(example.variantGroupId, group);
    }

    return examples.map((example) =>
      evaluatedExampleSchema.parse({
        ...example,
        drift: createDriftSummary(example.variantGroupId, byVariantGroup.get(example.variantGroupId) ?? [])
      })
    );
  }

  summarize(examples: EvaluatedExample[]): DriftSummary[] {
    const byVariantGroup = new Map<string, EvaluatedExample[]>();

    for (const example of examples) {
      const group = byVariantGroup.get(example.variantGroupId) ?? [];
      group.push(example);
      byVariantGroup.set(example.variantGroupId, group);
    }

    return [...byVariantGroup.entries()].map(([variantGroupId, group]) =>
      createDriftSummary(variantGroupId, group)
    );
  }
}

function createDriftSummary(
  variantGroupId: string,
  group: EvaluatedExample[]
): DriftSummary {
  const responseQualityMetrics = group
    .flatMap((example) => example.metricResults)
    .filter(
      (metricResult) => metricResult.metricFamily === "response_quality_drift"
    );

  if (group.length < 2) {
    return {
      variantGroupId,
      variantCount: group.length,
      pairedComparisonCount: responseQualityMetrics.length,
      status: "insufficient_variants",
      dominantClassification: "unclassified",
      classificationCounts: emptyClassificationCounts(),
      responseQualityMean: null,
      responseQualityStdDev: null,
      responseQualityCoefficientOfVariation: null,
      outcomeScoreDeltaMean: null,
      domainCorrectnessDeltaMean: null,
      feedbackIntegrationDeltaMean: null,
      requiredFindingsRecallDeltaMean: null,
      evidenceGroundingDeltaMean: null,
      escalationDecisionDeltaMean: null,
      memoryMean: null,
      memoryStdDev: null,
      memoryCoefficientOfVariation: null,
      contextMean: null,
      contextStdDev: null,
      contextCoefficientOfVariation: null
    };
  }

  const memoryScores = group.map((example) => example.memoryScore);
  const contextScores = group.map((example) => example.contextScore);
  const memoryMean = mean(memoryScores);
  const contextMean = mean(contextScores);
  const memoryStdDev = populationStdDev(memoryScores, memoryMean);
  const contextStdDev = populationStdDev(contextScores, contextMean);
  const memoryCoefficientOfVariation = memoryStdDev / Math.max(memoryMean, 0.05);
  const contextCoefficientOfVariation = contextStdDev / Math.max(contextMean, 0.05);
  const responseQualityScores = responseQualityMetrics.map(
    (metricResult) => metricResult.score
  );
  const responseQualityMean =
    responseQualityScores.length > 0 ? mean(responseQualityScores) : null;
  const responseQualityStdDev =
    responseQualityMean === null
      ? null
      : populationStdDev(responseQualityScores, responseQualityMean);
  const responseQualityCoefficientOfVariation =
    responseQualityMean === null || responseQualityStdDev === null
      ? null
      : responseQualityStdDev / Math.max(responseQualityMean, 0.05);
  const classificationCounts = responseQualityMetrics.reduce(
    (counts, metricResult) => {
      const classification = readDetailValue(metricResult.details, "classification");

      if (!classification) {
        return counts;
      }

      const classificationKey =
        DRIFT_CLASSIFICATION_KEYS[
          classification as keyof typeof DRIFT_CLASSIFICATION_KEYS
        ];

      if (!classificationKey) {
        return counts;
      }

      counts[classificationKey] += 1;
      return counts;
    },
    emptyClassificationCounts()
  );
  const dominantClassification = detectDominantClassification(classificationCounts);
  const outcomeScoreDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "outcomeScoreDelta"
  );
  const domainCorrectnessDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "domainCorrectnessDelta"
  );
  const feedbackIntegrationDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "feedbackIntegrationDelta"
  );
  const requiredFindingsRecallDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "requiredFindingsRecallDelta"
  );
  const evidenceGroundingDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "evidenceGroundingDelta"
  );
  const escalationDecisionDeltaMean = averageMetricDetail(
    responseQualityMetrics,
    "escalationDecisionDelta"
  );

  return {
    variantGroupId,
    variantCount: group.length,
    pairedComparisonCount: responseQualityMetrics.length,
    status:
      memoryCoefficientOfVariation < 0.15 &&
      contextCoefficientOfVariation < 0.15 &&
      (responseQualityCoefficientOfVariation === null ||
        responseQualityCoefficientOfVariation < 0.2)
        ? "passed"
        : "failed",
    dominantClassification,
    classificationCounts,
    responseQualityMean: roundNullable(responseQualityMean),
    responseQualityStdDev: roundNullable(responseQualityStdDev),
    responseQualityCoefficientOfVariation: roundNullable(
      responseQualityCoefficientOfVariation
    ),
    outcomeScoreDeltaMean,
    domainCorrectnessDeltaMean,
    feedbackIntegrationDeltaMean,
    requiredFindingsRecallDeltaMean,
    evidenceGroundingDeltaMean,
    escalationDecisionDeltaMean,
    memoryMean: round(memoryMean),
    memoryStdDev: round(memoryStdDev),
    memoryCoefficientOfVariation: round(memoryCoefficientOfVariation),
    contextMean: round(contextMean),
    contextStdDev: round(contextStdDev),
    contextCoefficientOfVariation: round(contextCoefficientOfVariation)
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageMetricDetail(
  responseQualityMetrics: EvaluatedExample["metricResults"],
  detailKey: string
): number | null {
  const deltas = responseQualityMetrics
    .map((metricResult) => readDelta(metricResult.details, detailKey))
    .filter((delta): delta is number => delta !== null);

  if (deltas.length === 0) {
    return null;
  }

  return round(mean(deltas));
}

function readDelta(
  details: Record<string, unknown>,
  detailKey: string
): number | null {
  const deltas = details.deltas;

  if (!deltas || typeof deltas !== "object" || Array.isArray(deltas)) {
    return null;
  }

  const value = (deltas as Record<string, unknown>)[detailKey];
  return typeof value === "number" ? value : null;
}

function readDetailValue(
  details: Record<string, unknown>,
  detailKey: string
): string | null {
  const value = details[detailKey];
  return typeof value === "string" ? value : null;
}

function emptyClassificationCounts(): DriftSummary["classificationCounts"] {
  return {
    qualityPreservingVariation: 0,
    outcomeOnlyDrift: 0,
    trajectoryOnlyDrift: 0,
    combinedDrift: 0
  };
}

function detectDominantClassification(
  classificationCounts: DriftSummary["classificationCounts"]
): DriftSummary["dominantClassification"] {
  const classificationEntries = [
    ["quality_preserving_variation", classificationCounts.qualityPreservingVariation],
    ["outcome_only_drift", classificationCounts.outcomeOnlyDrift],
    ["trajectory_only_drift", classificationCounts.trajectoryOnlyDrift],
    ["combined_drift", classificationCounts.combinedDrift]
  ] as const;
  let dominantClassification: DriftSummary["dominantClassification"] =
    "unclassified";
  let dominantCount = 0;

  for (const [classification, count] of classificationEntries) {
    if (count > dominantCount) {
      dominantClassification = classification;
      dominantCount = count;
    }
  }

  return dominantClassification;
}

function populationStdDev(values: number[], average: number): number {
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundNullable(value: number | null): number | null {
  return value === null ? null : round(value);
}

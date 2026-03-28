import { metricResultSchema, type MetricResult } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { createTrajectoryEvidenceSnapshot } from "./trajectory-evidence-extractor.js";

type TrajectoryMatchSummary = {
  expectedCount: number;
  matchedCount: number;
  missingCount: number;
  matched: string[];
  missing: string[];
};

export type TrajectoryCoverageDetails = {
  requiredStepCoverage: number;
  criticalToolCoverage: number;
  delegationAlignment: number;
  unnecessaryStepRate: number;
  loopingSignal: number;
  graphEfficiency: number;
  observedStepCount: number;
  expectedStepCount: number;
  extraStepCount: number;
  duplicateStepCount: number;
  traceSpanCount: number;
  matchedRequiredSteps: string[];
  missingRequiredSteps: string[];
  matchedCriticalTools: string[];
  missingCriticalTools: string[];
  matchedCriticalDelegations: string[];
  missingCriticalDelegations: string[];
  observedGraphPath: string[];
  observedTools: string[];
  observedDelegations: string[];
};

export type TrajectoryScoringExpectation = {
  requiredSteps: string[];
  criticalTools: string[];
  criticalDelegations: string[];
  allowedStepFlexibility: "exact" | "partial" | "unordered";
  allowAdditionalSteps: boolean;
};

export class TrajectoryCoverageScorer {
  score(bundle: RunBundle, expectation?: TrajectoryScoringExpectation): MetricResult {
    const snapshot = createTrajectoryEvidenceSnapshot(bundle);
    const resolvedExpectation = expectation ?? readFallbackExpectation(bundle);
    const requiredStepMatch = matchSequence(
      resolvedExpectation.requiredSteps,
      snapshot.observed.graphPath,
      resolvedExpectation.allowedStepFlexibility
    );
    const criticalToolMatch = matchSet(
      resolvedExpectation.criticalTools,
      snapshot.observed.toolNames
    );
    const delegationMatch = matchDelegations(
      resolvedExpectation.criticalDelegations,
      snapshot.observed.delegationIds,
      snapshot.observed.delegationTaskSummaries
    );
    const duplicateStepCount = countDuplicateSteps(snapshot.observed.graphPath);
    const extraStepCount = countExtraSteps(
      resolvedExpectation.requiredSteps,
      snapshot.observed.graphPath
    );
    const observedStepCount = snapshot.observed.graphPath.length;
    const requiredStepCoverage = scoreRatio(
      requiredStepMatch.matchedCount,
      requiredStepMatch.expectedCount
    );
    const criticalToolCoverage = scoreRatio(
      criticalToolMatch.matchedCount,
      criticalToolMatch.expectedCount
    );
    const delegationAlignment = scoreRatio(
      delegationMatch.matchedCount,
      delegationMatch.expectedCount
    );
    const unnecessaryStepRate = Math.min(
      1,
      ratio(extraStepCount, Math.max(observedStepCount, 1)) *
        (resolvedExpectation.allowAdditionalSteps ? 1 : 1.2) *
        (resolvedExpectation.allowedStepFlexibility === "exact" ? 1.15 : 1)
    );
    const loopingSignal = ratio(
      duplicateStepCount,
      Math.max(observedStepCount, 1)
    );
    const graphEfficiency = roundScore(
      weightedAverage([
        requiredStepCoverage,
        criticalToolCoverage,
        delegationAlignment,
        1 - unnecessaryStepRate,
        1 - loopingSignal
      ])
    );

    return metricResultSchema.parse({
      metricId: `trajectory-coverage:${bundle.bundleId}`,
      metricFamily: "trajectory_coverage",
      score: graphEfficiency,
      passed: graphEfficiency >= 0.75,
      summary: buildSummary(
        requiredStepCoverage,
        criticalToolCoverage,
        delegationAlignment,
        graphEfficiency
      ),
      details: {
        requiredStepCoverage,
        criticalToolCoverage,
        delegationAlignment,
        unnecessaryStepRate: roundScore(unnecessaryStepRate),
        loopingSignal: roundScore(loopingSignal),
        graphEfficiency,
        observedStepCount,
        expectedStepCount: resolvedExpectation.requiredSteps.length,
        extraStepCount,
        duplicateStepCount,
        traceSpanCount: snapshot.observed.traceSpanCount,
        matchedRequiredSteps: requiredStepMatch.matched,
        missingRequiredSteps: requiredStepMatch.missing,
        matchedCriticalTools: criticalToolMatch.matched,
        missingCriticalTools: criticalToolMatch.missing,
        matchedCriticalDelegations: delegationMatch.matched,
        missingCriticalDelegations: delegationMatch.missing,
        observedGraphPath: snapshot.observed.graphPath,
        observedTools: snapshot.observed.toolNames,
        observedDelegations: snapshot.observed.delegationIds
      },
      evidenceRefs: []
    });
  }
}

function readFallbackExpectation(
  bundle: RunBundle
): TrajectoryScoringExpectation {
  const trajectory = bundle.example.evaluationSpec.trajectory;

  return {
    requiredSteps: trajectory.requiredSteps,
    criticalTools: trajectory.criticalTools,
    criticalDelegations: trajectory.criticalDelegations,
    allowedStepFlexibility: trajectory.allowedStepFlexibility,
    allowAdditionalSteps: trajectory.allowAdditionalSteps
  };
}

function matchSequence(
  expected: string[],
  observed: string[],
  allowedStepFlexibility: TrajectoryScoringExpectation["allowedStepFlexibility"]
): TrajectoryMatchSummary {
  if (expected.length === 0) {
    return {
      expectedCount: 0,
      matchedCount: 0,
      missingCount: 0,
      matched: [],
      missing: []
    };
  }

  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const matched = expected.filter((step) => observedSet.has(step));
  const missing = expected.filter((step) => !observedSet.has(step));
  const orderedMatchCount =
    allowedStepFlexibility === "unordered"
      ? matched.length
      : longestCommonSubsequence(expected, observed);

  return {
    expectedCount: expected.length,
    matchedCount: Math.min(matched.length, orderedMatchCount),
    missingCount: missing.length,
    matched,
    missing
  };
}

function matchSet(expected: string[], observed: string[]): TrajectoryMatchSummary {
  if (expected.length === 0) {
    return {
      expectedCount: 0,
      matchedCount: 0,
      missingCount: 0,
      matched: [],
      missing: []
    };
  }

  const observedSet = new Set(observed);
  const matched = expected.filter((item) => observedSet.has(item));
  const missing = expected.filter((item) => !observedSet.has(item));

  return {
    expectedCount: expected.length,
    matchedCount: matched.length,
    missingCount: missing.length,
    matched,
    missing
  };
}

function matchDelegations(
  expected: string[],
  observedIds: string[],
  observedSummaries: string[]
): TrajectoryMatchSummary {
  if (expected.length === 0) {
    return {
      expectedCount: 0,
      matchedCount: 0,
      missingCount: 0,
      matched: [],
      missing: []
    };
  }

  const observedValues = new Set([...observedIds, ...observedSummaries]);
  const matched = expected.filter((delegation) => observedValues.has(delegation));
  const missing = expected.filter((delegation) => !observedValues.has(delegation));

  return {
    expectedCount: expected.length,
    matchedCount: matched.length,
    missingCount: missing.length,
    matched,
    missing
  };
}

function countDuplicateSteps(steps: string[]): number {
  return Math.max(0, steps.length - new Set(steps).size);
}

function countExtraSteps(expected: string[], observed: string[]): number {
  const expectedSet = new Set(expected);
  return observed.filter((step) => !expectedSet.has(step)).length;
}

function longestCommonSubsequence(expected: string[], observed: string[]): number {
  const table = Array.from({ length: expected.length + 1 }, () =>
    Array<number>(observed.length + 1).fill(0)
  );

  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    const currentRow = table[expectedIndex] ?? [];
    const previousRow = table[expectedIndex - 1] ?? [];

    for (let observedIndex = 1; observedIndex <= observed.length; observedIndex += 1) {
      if (expected[expectedIndex - 1] === observed[observedIndex - 1]) {
        currentRow[observedIndex] = (previousRow[observedIndex - 1] ?? 0) + 1;
      } else {
        currentRow[observedIndex] = Math.max(
          previousRow[observedIndex] ?? 0,
          currentRow[observedIndex - 1] ?? 0
        );
      }
    }
  }

  const finalRow = table[expected.length] ?? [];
  return finalRow[observed.length] ?? 0;
}

function scoreRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 1;
  }

  return roundScore(Math.max(0, Math.min(1, numerator / denominator)));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, numerator / denominator));
}

function weightedAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const weights = [0.3, 0.2, 0.2, 0.15, 0.15];
  return values.reduce((total, value, index) => total + value * (weights[index] ?? 0), 0);
}

function buildSummary(
  requiredStepCoverage: number,
  criticalToolCoverage: number,
  delegationAlignment: number,
  graphEfficiency: number
): string {
  return [
    `Required step coverage ${requiredStepCoverage}.`,
    `Critical tool coverage ${criticalToolCoverage}.`,
    `Delegation alignment ${delegationAlignment}.`,
    `Graph efficiency ${graphEfficiency}.`
  ].join(" ");
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

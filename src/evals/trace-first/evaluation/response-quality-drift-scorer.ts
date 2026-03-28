import type { MetricResult } from "../../contracts/metric-result-schema.js";
import { metricResultSchema } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { compareTraceEvidence } from "./trace-evidence-extractor.js";
import { analyzeOutcomeCoverage } from "./outcome-coverage.js";

export type ResponseQualityDriftClassification =
  | "quality_preserving_variation"
  | "outcome_only_drift"
  | "trajectory_only_drift"
  | "combined_drift";

export class ResponseQualityDriftScorer {
  score(
    currentBundle: RunBundle,
    baselineBundle: RunBundle | null,
    options: {
      currentDomainCorrectnessScore: number;
      baselineDomainCorrectnessScore: number;
      currentFeedbackIntegrationScore: number;
      baselineFeedbackIntegrationScore: number;
    }
  ): MetricResult | null {
    if (currentBundle.mode !== "feedback_rerun" || baselineBundle === null) {
      return null;
    }

    const currentOutcome = analyzeOutcomeCoverage(currentBundle);
    const baselineOutcome = analyzeOutcomeCoverage(baselineBundle);
    const evidenceComparison = compareTraceEvidence(currentBundle, baselineBundle);
    const outcomeScoreDelta = roundDelta(currentOutcome.score - baselineOutcome.score);
    const domainCorrectnessDelta = roundDelta(
      options.currentDomainCorrectnessScore - options.baselineDomainCorrectnessScore
    );
    const feedbackIntegrationDelta = roundDelta(
      options.currentFeedbackIntegrationScore - options.baselineFeedbackIntegrationScore
    );
    const evidenceGroundingDelta = roundDelta(
      currentOutcome.evidenceCoverage - baselineOutcome.evidenceCoverage
    );
    const escalationDecisionDelta = roundDelta(
      currentOutcome.dispositionScore - baselineOutcome.dispositionScore
    );
    const trajectorySignal = computeTrajectorySignal(evidenceComparison);
    const outcomeSignal = computeOutcomeSignal({
      outcomeScoreDelta,
      domainCorrectnessDelta,
      feedbackIntegrationDelta,
      evidenceGroundingDelta,
      requiredFindingsRecallDelta: evidenceComparison.requiredFindingRecallDelta,
      escalationDecisionDelta
    });
    const classification = classifyDrift(outcomeSignal, trajectorySignal);
    const score = scoreClassification(classification, outcomeSignal, trajectorySignal);

    return metricResultSchema.parse({
      metricId: `response-quality-drift:${currentBundle.bundleId}`,
      metricFamily: "response_quality_drift",
      score,
      passed: score >= 0.75,
      summary: buildSummary(classification, score, outcomeScoreDelta, trajectorySignal),
      details: {
        baselineRunId: baselineBundle.runId,
        classification,
        outcomeSignal,
        trajectorySignal,
        deltas: {
          outcomeScoreDelta,
          domainCorrectnessDelta,
          feedbackIntegrationDelta,
          evidenceGroundingDelta,
          requiredFindingsRecallDelta: evidenceComparison.requiredFindingRecallDelta,
          escalationDecisionDelta
        },
        evidenceComparison
      },
      evidenceRefs: currentBundle.example.evaluationSpec.expectedEvidenceRefs
    });
  }
}

function classifyDrift(
  outcomeSignal: number,
  trajectorySignal: number
): ResponseQualityDriftClassification {
  const outcomeDrifted = outcomeSignal >= 0.15;
  const trajectoryDrifted = trajectorySignal >= 0.25;

  if (outcomeDrifted && trajectoryDrifted) {
    return "combined_drift";
  }

  if (outcomeDrifted) {
    return "outcome_only_drift";
  }

  if (trajectoryDrifted) {
    return "trajectory_only_drift";
  }

  return "quality_preserving_variation";
}

function scoreClassification(
  classification: ResponseQualityDriftClassification,
  outcomeSignal: number,
  trajectorySignal: number
): number {
  switch (classification) {
    case "quality_preserving_variation":
      return roundScore(1 - Math.max(outcomeSignal * 0.5, trajectorySignal * 0.35));
    case "trajectory_only_drift":
      return roundScore(0.7 - trajectorySignal * 0.25);
    case "outcome_only_drift":
      return roundScore(0.55 - outcomeSignal * 0.25);
    case "combined_drift":
      return roundScore(0.35 - average([outcomeSignal, trajectorySignal]) * 0.2);
  }
}

function computeOutcomeSignal(deltas: {
  outcomeScoreDelta: number;
  domainCorrectnessDelta: number;
  feedbackIntegrationDelta: number;
  evidenceGroundingDelta: number;
  requiredFindingsRecallDelta: number;
  escalationDecisionDelta: number;
}): number {
  return roundScore(
    average([
      absoluteRegression(deltas.outcomeScoreDelta),
      absoluteRegression(deltas.domainCorrectnessDelta),
      absoluteRegression(deltas.feedbackIntegrationDelta),
      absoluteRegression(deltas.evidenceGroundingDelta),
      absoluteRegression(deltas.requiredFindingsRecallDelta),
      absoluteRegression(deltas.escalationDecisionDelta)
    ])
  );
}

function computeTrajectorySignal(
  comparison: ReturnType<typeof compareTraceEvidence>
): number {
  return roundScore(
    average([
      comparison.decisionChanged ? 1 : 0,
      Math.min(1, Math.abs(comparison.savedCandidateDelta)),
      Math.min(1, Math.abs(comparison.retrievedCandidateDelta)),
      Math.min(1, Math.abs(comparison.usedCandidateDelta)),
      Math.min(1, Math.abs(comparison.skippedSaveDelta)),
      Math.min(1, Math.abs(comparison.skippedRetrievalDelta))
    ])
  );
}

function absoluteRegression(value: number): number {
  return Math.max(0, -value);
}

function buildSummary(
  classification: ResponseQualityDriftClassification,
  score: number,
  outcomeScoreDelta: number,
  trajectorySignal: number
): string {
  return [
    `Classification ${classification}.`,
    `Score ${score}.`,
    `Outcome delta ${outcomeScoreDelta}.`,
    `Trajectory signal ${trajectorySignal}.`
  ].join(" ");
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function roundDelta(value: number): number {
  return Number(Math.max(-1, Math.min(1, value)).toFixed(4));
}

import type { FeedbackEvent } from "../../../domain/feedback/feedback-event-schema.js";
import type { MetricResult } from "../../contracts/metric-result-schema.js";
import { metricResultSchema } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import {
  analyzeOutcomeCoverage,
  containsMeaningfulContent
} from "./outcome-coverage.js";

export class FeedbackIntegrationScorer {
  score(
    bundle: RunBundle,
    baselineBundle: RunBundle | null
  ): MetricResult | null {
    const expectedFeedback = bundle.feedbackTurns.filter(
      (feedbackTurn) => bundle.feedbackIds.includes(feedbackTurn.feedbackId)
    );

    if (bundle.feedbackIds.length === 0 && expectedFeedback.length === 0) {
      return null;
    }

    if (expectedFeedback.length === 0) {
      return metricResultSchema.parse({
        metricId: `feedback-integration:${bundle.bundleId}`,
        metricFamily: "feedback_integration",
        score: 0,
        passed: false,
        summary:
          "Feedback ids were present, but the evaluation contract did not include feedback expectations.",
        details: {
          baselinePresent: baselineBundle !== null,
          feedbackIds: bundle.feedbackIds
        },
        evidenceRefs: bundle.feedbackIds
      });
    }

    const correctedFactCoverage = average(
      expectedFeedback.map((feedbackTurn) =>
        scoreTextCoverage(bundle.finalResponse, feedbackTurn.correctedFacts, 1)
      ),
      1
    );
    const baselineCorrectedFactCoverage = baselineBundle
      ? average(
          expectedFeedback.map((feedbackTurn) =>
            scoreTextCoverage(
              baselineBundle.finalResponse,
              feedbackTurn.correctedFacts,
              1
            )
          ),
          0
        )
      : 0;
    const instructionCoverage = average(
      expectedFeedback.map((feedbackTurn) =>
        scoreTextCoverage(bundle.finalResponse, feedbackTurn.instructions, 1)
      ),
      1
    );
    const behaviorChangeScore = baselineBundle
      ? clamp01(correctedFactCoverage - baselineCorrectedFactCoverage)
      : correctedFactCoverage;
    const currentDomainScore = analyzeOutcomeCoverage(bundle).score;
    const baselineDomainScore = baselineBundle
      ? analyzeOutcomeCoverage(baselineBundle).score
      : 0;
    const domainImprovement = baselineBundle
      ? clamp01(currentDomainScore - baselineDomainScore)
      : currentDomainScore;
    const score = roundScore(
      correctedFactCoverage * 0.45 +
        instructionCoverage * 0.2 +
        behaviorChangeScore * 0.2 +
        domainImprovement * 0.15
    );

    return metricResultSchema.parse({
      metricId: `feedback-integration:${bundle.bundleId}`,
      metricFamily: "feedback_integration",
      score,
      passed: score >= 0.75,
      summary: buildSummary(expectedFeedback, baselineBundle !== null, score),
      details: {
        baselinePresent: baselineBundle !== null,
        correctedFactCoverage,
        baselineCorrectedFactCoverage,
        instructionCoverage,
        behaviorChangeScore,
        currentDomainScore,
        baselineDomainScore,
        domainImprovement
      },
      evidenceRefs: expectedFeedback.map(
        (feedbackTurn) => feedbackTurn.feedbackId
      )
    });
  }
}

function scoreTextCoverage(
  haystack: string,
  expectedTexts: string[],
  fallback: number
): number {
  if (expectedTexts.length === 0) {
    return fallback;
  }

  return average(
    expectedTexts.map((expectedText) =>
      containsMeaningfulContent(haystack, expectedText) ? 1 : 0
    ),
    fallback
  );
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) {
    return fallback;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildSummary(
  expectedFeedback: FeedbackEvent[],
  hasBaseline: boolean,
  score: number
): string {
  const correctedFactCount = expectedFeedback.reduce(
    (count, feedbackTurn) => count + feedbackTurn.correctedFacts.length,
    0
  );
  const baselineSummary = hasBaseline
    ? "Baseline comparison was available."
    : "Baseline comparison was unavailable.";

  return `${correctedFactCount} corrected facts were evaluated. ${baselineSummary} Score ${score}.`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(clamp01(value).toFixed(4));
}

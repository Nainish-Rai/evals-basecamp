import { describe, expect, it } from "vitest";

import { DriftAggregator } from "../../../src/evals/trace-first/evaluation/drift-aggregator.js";
import { evaluatedExampleSchema } from "../../../src/evals/trace-first/contracts/evaluated-example-schema.js";

describe("DriftAggregator", () => {
  it("computes group-level drift summaries from memory and context scores", () => {
    const aggregator = new DriftAggregator();
    const examples = [
      createEvaluatedExample("example-1", "variant-a", 0.8, 0.7),
      createEvaluatedExample("example-2", "variant-a", 0.82, 0.72, {
        score: 0.92,
        classification: "quality_preserving_variation",
        deltas: {
          outcomeScoreDelta: 0,
          domainCorrectnessDelta: 0,
          feedbackIntegrationDelta: 0.9,
          requiredFindingsRecallDelta: 0,
          evidenceGroundingDelta: 0,
          escalationDecisionDelta: 0
        }
      }),
      createEvaluatedExample("example-3", "variant-b", 0.5, 0.4)
    ];

    const summaries = aggregator.summarize(examples);

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantGroupId: "variant-a",
          status: "passed",
          variantCount: 2,
          pairedComparisonCount: 1,
          dominantClassification: "quality_preserving_variation",
          responseQualityMean: 0.92
        }),
        expect.objectContaining({
          variantGroupId: "variant-b",
          status: "insufficient_variants",
          variantCount: 1
        })
      ])
    );
  });
});

function createEvaluatedExample(
  exampleId: string,
  variantGroupId: string,
  memoryScore: number,
  contextScore: number,
  responseQualityDrift?: {
    score: number;
    classification: string;
    deltas: Record<string, number>;
  }
) {
  return evaluatedExampleSchema.parse({
    bundleId: `${exampleId}-bundle`,
    exampleId,
    variantGroupId,
    runId: `${exampleId}-run`,
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent",
    taskType: "risk",
    mode: "initial",
    accuracyScore: 0.9,
    domainCorrectnessScore: 0.9,
    feedbackIntegrationScore: 1,
    accuracyBin: "0.90-1.00",
    memoryScore,
    memoryState: "correct_save_correct_needed_retrieval",
    memoryPassed: true,
    contextScore,
    contextPassed: true,
    retryAttribution: {
      systemPromptVagueness: 0,
      toolDefinitionAmbiguity: 0,
      missingContext: 0,
      other: 0
    },
    peerMetrics: {
      systemPromptTokens: 200,
      toolDefinitionTokens: 100,
      multimodalRawTokens: 120,
      multimodalCompressedTokens: 40,
      toolRetryCount: 0
    },
    participantContextScores: [
      {
        participantId: "supervisor",
        participantType: "supervisor",
        complete: true,
        score: contextScore
      }
    ],
    contextDiagnostics: {
      contextPrecision: 1,
      contextRecall: 1,
      systemPromptTokenOverhead: 200,
      toolDefinitionTokenOverhead: 100,
      tokenToValueRatio: 0.5,
      contextBloatIndex: 0.25,
      duplicateContextRate: 0,
      contextPartitionEfficiency: 1,
      artifactReuseRate: 1,
      activeToolSurfaceArea: 2,
      unusedToolDefinitionRatio: 0,
      duplicateToolDefinitionRate: 0,
      toolOverlapRate: 0,
      fileReadRedundancyRate: 0,
      minimalSufficientContextTokens: 250,
      currentContextTokens: 300,
      removableContextTokens: 50,
      ablationLossPerArtifact: 0.1,
      progressiveContextGain: 0.2,
      contextSaturationPointTokens: 275,
      budgetConstrainedRobustness: 0.9,
      contextInheritanceRedundancy: 0
    },
    metricResults: responseQualityDrift
      ? [
          {
            metricId: `response-quality-drift:${exampleId}`,
            metricFamily: "response_quality_drift",
            score: responseQualityDrift.score,
            passed: true,
            summary: "Synthetic response-quality drift metric.",
            details: {
              classification: responseQualityDrift.classification,
              deltas: responseQualityDrift.deltas
            },
            evidenceRefs: []
          }
        ]
      : []
  });
}

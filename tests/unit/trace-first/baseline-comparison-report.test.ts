import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { evaluatedExampleSchema } from "../../../src/evals/trace-first/contracts/evaluated-example-schema.js";
import {
  buildFeedbackRerunComparisonReport,
  summarizeFeedbackRerunComparisonReport
} from "../../../src/evals/trace-first/reporting/baseline-comparison-report.js";

describe("baseline-comparison-report", () => {
  it("pairs reruns with their baselines and summarizes benchmark subset drift", () => {
    const baselineBundle = buildBundle({
      bundleId: "bundle-baseline-1",
      runId: "run-baseline-1",
      mode: "initial",
      baselineComparisonMode: "baseline_relative_comparison",
      finalResponse: "Hold the file for document collection.",
      metricResults: []
    });
    const currentBundle = buildBundle({
      bundleId: "bundle-current-1",
      runId: "run-current-1",
      mode: "feedback_rerun",
      baselineComparisonMode: "baseline_relative_comparison",
      finalResponse: "Hold the file for document collection after the correction.",
      metricResults: [
        {
          metricId: "response-quality-drift:bundle-current-1",
          metricFamily: "response_quality_drift",
          score: 0.94,
          passed: true,
          summary: "Stable rerun.",
          details: {
            classification: "quality_preserving_variation",
            deltas: {
              outcomeScoreDelta: 0,
              domainCorrectnessDelta: 0,
              feedbackIntegrationDelta: 0.9,
              evidenceGroundingDelta: 0,
              requiredFindingsRecallDelta: 0,
              escalationDecisionDelta: 0
            }
          },
          evidenceRefs: ["artifact-policy"]
        }
      ]
    });
    const excludedBundle = buildBundle({
      bundleId: "bundle-absolute-1",
      runId: "run-absolute-1",
      mode: "feedback_rerun",
      baselineComparisonMode: "absolute_rubric_scoring",
      finalResponse: "Absolute scoring example.",
      metricResults: []
    });

    const baselineExample = evaluatedExampleSchema.parse({
      bundleId: "bundle-baseline-1",
      exampleId: "example-baseline-1",
      variantGroupId: "variant-baseline-1",
      runId: "run-baseline-1",
      agentLabel: "workspace",
      modelLabel: "local-scenario-agent",
      taskType: "compliance",
      mode: "initial",
      accuracyScore: 0.72,
      domainCorrectnessScore: 0.7,
      feedbackIntegrationScore: 0,
      accuracyBin: "0.50-0.74",
      memoryScore: 0.78,
      memoryState: "correct_save_correct_needed_retrieval",
      memoryPassed: true,
      trajectoryScore: 0.8,
      trajectoryPassed: true,
      contextScore: 0.76,
      contextPassed: true,
      retryAttribution: {
        systemPromptVagueness: 0,
        toolDefinitionAmbiguity: 0,
        missingContext: 0,
        other: 0
      },
      peerMetrics: {
        systemPromptTokens: 100,
        toolDefinitionTokens: 50,
        multimodalRawTokens: 0,
        multimodalCompressedTokens: 0,
        toolRetryCount: 0
      },
      participantContextScores: [],
      contextDiagnostics: buildContextDiagnostics(),
      metricResults: []
    });
    const currentExample = evaluatedExampleSchema.parse({
      bundleId: "bundle-current-1",
      exampleId: "example-baseline-1",
      variantGroupId: "variant-baseline-1",
      runId: "run-current-1",
      agentLabel: "workspace",
      modelLabel: "local-scenario-agent",
      taskType: "compliance",
      mode: "feedback_rerun",
      accuracyScore: 0.84,
      domainCorrectnessScore: 0.8,
      feedbackIntegrationScore: 0.9,
      accuracyBin: "0.75-0.89",
      memoryScore: 0.82,
      memoryState: "correct_save_correct_needed_retrieval",
      memoryPassed: true,
      trajectoryScore: 0.84,
      trajectoryPassed: true,
      contextScore: 0.79,
      contextPassed: true,
      retryAttribution: {
        systemPromptVagueness: 0,
        toolDefinitionAmbiguity: 0,
        missingContext: 0,
        other: 0
      },
      peerMetrics: {
        systemPromptTokens: 110,
        toolDefinitionTokens: 52,
        multimodalRawTokens: 0,
        multimodalCompressedTokens: 0,
        toolRetryCount: 0
      },
      participantContextScores: [],
      contextDiagnostics: buildContextDiagnostics(),
      metricResults: [
        {
          metricId: "response-quality-drift:bundle-current-1",
          metricFamily: "response_quality_drift",
          score: 0.94,
          passed: true,
          summary: "Stable rerun.",
          details: {
            classification: "quality_preserving_variation",
            deltas: {
              outcomeScoreDelta: 0,
              domainCorrectnessDelta: 0.1,
              feedbackIntegrationDelta: 0.9,
              evidenceGroundingDelta: 0,
              requiredFindingsRecallDelta: 0,
              escalationDecisionDelta: 0
            }
          },
          evidenceRefs: ["artifact-policy"]
        }
      ]
    });

    const bundles = [baselineBundle, currentBundle, excludedBundle];
    const examples = [baselineExample, currentExample];
    const records = buildFeedbackRerunComparisonReport(bundles, examples);

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected one baseline comparison record");
    }

    expect(record).toMatchObject({
      comparisonId: "run-current-1::run-baseline-1",
      benchmarkSubset: "variant-baseline-1",
      baselineComparisonMode: "baseline_relative_comparison",
      comparisonStatus: "improved",
      driftClassification: "quality_preserving_variation",
      pairMetricFamilies: ["response_quality_drift"]
    });
    expect(record.current.responseQualityScore).toBe(0.94);
    expect(record.baseline.responseQualityScore).toBeNull();

    expect(summarizeFeedbackRerunComparisonReport(records)).toMatchObject({
      comparisonCount: 1,
      benchmarkSubsetCount: 1,
      improvedCount: 1,
      regressedCount: 0,
      stableCount: 0,
      mixedCount: 0,
      averageAccuracyDelta: 0.12,
      averageDomainCorrectnessDelta: 0.1,
      averageFeedbackIntegrationDelta: 0.9,
      averageMemoryDelta: 0.04,
      averageTrajectoryDelta: 0.04,
      averageContextDelta: 0.03
    });
  });
});

function buildBundle(options: {
  bundleId: string;
  runId: string;
  mode: "initial" | "feedback_rerun";
  baselineComparisonMode: "baseline_relative_comparison" | "absolute_rubric_scoring";
  finalResponse: string;
  metricResults: Array<{
    metricId: string;
    metricFamily: "response_quality_drift";
    score: number;
    passed: boolean;
    summary: string;
    details: Record<string, unknown>;
    evidenceRefs: string[];
  }>;
}) {
  return runBundleSchema.parse({
    bundleId: options.bundleId,
    example: {
      exampleId: "example-baseline-1",
      variantGroupId: "variant-baseline-1",
      taskType: "compliance",
      task: "Review the baseline pair.",
      skills: [],
      data: [],
      feedbackTurns: [],
      evaluationSpec: {
        instruction: "Review the baseline pair.",
        minimumCorrectnessThreshold: 0.8,
        baselineComparisonMode: options.baselineComparisonMode,
        requiredFindings: ["The file should be held for document collection."],
        expectedEvidenceRefs: ["artifact-policy"],
        trajectory: {
          requiredSteps: ["planToolWork", "executeTool", "composeFinalAnswer"],
          criticalTools: ["policy_search"],
          criticalDelegations: [],
          allowedStepFlexibility: "partial",
          allowAdditionalSteps: true
        },
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 0,
          toolDefinitionTokens: 0
        }
      }
    },
    mode: options.mode,
    runId: options.runId,
    traceId: null,
    feedbackIds: [],
    finalResponse: options.finalResponse,
    outputArtifacts: [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    },
    agentMetadata: {},
    trace: null,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent"
  });
}

function buildContextDiagnostics() {
    return {
      contextPrecision: 1,
      contextRecall: 1,
      systemPromptTokenOverhead: 100,
      toolDefinitionTokenOverhead: 50,
      tokenToValueRatio: 0.5,
      contextBloatIndex: 0.1,
      duplicateContextRate: 0,
      contextPartitionEfficiency: 1,
      artifactReuseRate: 1,
      activeToolSurfaceArea: 1,
      unusedToolDefinitionRatio: 0,
      duplicateToolDefinitionRate: 0,
      toolOverlapRate: 0,
      fileReadRedundancyRate: 0,
      minimalSufficientContextTokens: 100,
      currentContextTokens: 120,
      removableContextTokens: 20,
      ablationLossPerArtifact: 0,
      progressiveContextGain: 0.5,
      contextSaturationPointTokens: 140,
      budgetConstrainedRobustness: 1,
      contextInheritanceRedundancy: 0
    };
  }

import { describe, expect, it } from "vitest";

import { baselineArtifactSchema } from "../../../src/evals/trace-first/contracts/baseline-artifact-schema.js";
import { evaluatedExampleSchema } from "../../../src/evals/trace-first/contracts/evaluated-example-schema.js";
import { subsetManifestSchema } from "../../../src/evals/trace-first/contracts/subset-manifest-schema.js";
import {
  buildHistoricalRegressionComparisonReport,
  evaluateHistoricalRegressionGate,
  summarizeHistoricalRegressionReport
} from "../../../src/evals/trace-first/reporting/historical-regression-report.js";

describe("historical-regression-report", () => {
  it("compares current examples against a stored baseline and passes the gate when within thresholds", () => {
    const subset = subsetManifestSchema.parse({
      subsetId: "smoke",
      label: "Smoke",
      description: "Smoke subset",
      expectedScenarioIds: ["scenario-compliance-001"],
      regressionThresholds: {
        maxDomainCorrectnessMeanDrop: 0.05,
        maxTrajectoryMeanDrop: 0.05,
        maxContextMeanDrop: 0.05,
        maxMemoryMeanDrop: 0.05,
        maxResponseQualityMeanDrop: 0.05,
        maxPerExampleDrop: 0.1,
        minComparableExampleRate: 1
      }
    });
    const baselineExample = buildExample({
      runId: "run-baseline-1",
      mode: "initial",
      domainCorrectnessScore: 0.9,
      trajectoryScore: 0.9,
      contextScore: 0.88,
      memoryScore: 0.86,
      responseQualityScore: 0.91
    });
    const currentExample = buildExample({
      runId: "run-current-1",
      mode: "initial",
      domainCorrectnessScore: 0.88,
      trajectoryScore: 0.88,
      contextScore: 0.86,
      memoryScore: 0.84,
      responseQualityScore: 0.89
    });
    const baselineArtifact = baselineArtifactSchema.parse({
      artifactVersion: 1,
      subset,
      createdAt: "2026-03-28T00:00:00.000Z",
      sourceCommit: "abc123",
      notes: null,
      evaluationSummary: {
        evaluatedExampleCount: 1,
        metricResultCount: 1
      },
      metricAverages: {},
      examples: [baselineExample]
    });

    const comparisons = buildHistoricalRegressionComparisonReport(
      [currentExample],
      baselineArtifact,
      subset
    );
    const summary = summarizeHistoricalRegressionReport(
      comparisons,
      [currentExample],
      baselineArtifact,
      subset
    );
    const gate = evaluateHistoricalRegressionGate(comparisons, summary, subset);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.deltas.domainCorrectnessScoreDelta).toBe(-0.02);
    expect(summary.comparableExampleRate).toBe(1);
    expect(gate.status).toBe("passed");
  });

  it("fails the gate when a metric regresses beyond the configured threshold", () => {
    const subset = subsetManifestSchema.parse({
      subsetId: "smoke",
      label: "Smoke",
      description: "Smoke subset",
      expectedScenarioIds: ["scenario-compliance-001"],
      regressionThresholds: {
        maxDomainCorrectnessMeanDrop: 0.03,
        maxTrajectoryMeanDrop: 0.03,
        maxContextMeanDrop: 0.03,
        maxMemoryMeanDrop: 0.03,
        maxResponseQualityMeanDrop: 0.03,
        maxPerExampleDrop: 0.05,
        minComparableExampleRate: 1
      }
    });
    const baselineExample = buildExample({
      runId: "run-baseline-2",
      mode: "initial",
      domainCorrectnessScore: 0.9,
      trajectoryScore: 0.9,
      contextScore: 0.9,
      memoryScore: 0.9,
      responseQualityScore: 0.9
    });
    const currentExample = buildExample({
      runId: "run-current-2",
      mode: "initial",
      domainCorrectnessScore: 0.7,
      trajectoryScore: 0.88,
      contextScore: 0.88,
      memoryScore: 0.88,
      responseQualityScore: 0.88
    });
    const baselineArtifact = baselineArtifactSchema.parse({
      artifactVersion: 1,
      subset,
      createdAt: "2026-03-28T00:00:00.000Z",
      sourceCommit: null,
      notes: null,
      evaluationSummary: {
        evaluatedExampleCount: 1,
        metricResultCount: 1
      },
      metricAverages: {},
      examples: [baselineExample]
    });

    const comparisons = buildHistoricalRegressionComparisonReport(
      [currentExample],
      baselineArtifact,
      subset
    );
    const summary = summarizeHistoricalRegressionReport(
      comparisons,
      [currentExample],
      baselineArtifact,
      subset
    );
    const gate = evaluateHistoricalRegressionGate(comparisons, summary, subset);

    expect(gate.status).toBe("failed");
    expect(gate.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Average domain correctness delta"),
        expect.stringContaining("regressed on domain correctness")
      ])
    );
  });
});

function buildExample(options: {
  runId: string;
  mode: "initial" | "feedback_rerun";
  domainCorrectnessScore: number;
  trajectoryScore: number;
  contextScore: number;
  memoryScore: number;
  responseQualityScore: number | null;
}) {
  return evaluatedExampleSchema.parse({
    bundleId: `${options.runId}-bundle`,
    exampleId: "scenario-compliance-001",
    variantGroupId: "scenario-compliance-001",
    runId: options.runId,
    agentLabel: "tool_chain",
    modelLabel: "local-scenario-agent",
    taskType: "compliance",
    mode: options.mode,
    accuracyScore: 0.9,
    domainCorrectnessScore: options.domainCorrectnessScore,
    feedbackIntegrationScore: 1,
    accuracyBin: "0.90-1.00",
    memoryScore: options.memoryScore,
    memoryState: "correct_save_correct_needed_retrieval",
    memoryPassed: true,
    trajectoryScore: options.trajectoryScore,
    trajectoryPassed: true,
    contextScore: options.contextScore,
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
    contextDiagnostics: {
      contextPrecision: 1,
      contextRecall: 1,
      systemPromptTokenOverhead: 10,
      toolDefinitionTokenOverhead: 10,
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
      ablationLossPerArtifact: 0.1,
      progressiveContextGain: 0.2,
      contextSaturationPointTokens: 140,
      budgetConstrainedRobustness: 1,
      contextInheritanceRedundancy: 0
    },
    metricResults:
      options.responseQualityScore === null
        ? []
        : [
            {
              metricId: `response-quality-drift:${options.runId}`,
              metricFamily: "response_quality_drift",
              score: options.responseQualityScore,
              passed: true,
              summary: "Historical regression fixture.",
              details: {},
              evidenceRefs: []
            }
          ]
  });
}

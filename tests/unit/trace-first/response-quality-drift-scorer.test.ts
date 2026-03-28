import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { ResponseQualityDriftScorer } from "../../../src/evals/trace-first/evaluation/response-quality-drift-scorer.js";

describe("ResponseQualityDriftScorer", () => {
  it("classifies stable reruns as quality-preserving variation", () => {
    const baselineBundle = buildBundle({
      bundleId: "bundle-response-drift-initial",
      mode: "initial",
      runId: "run-response-drift-initial",
      finalResponse:
        "The customer file is missing valid proof of address. Disposition: hold_for_document_collection.",
      outputArtifacts: ["artifact-policy"]
    });
    const rerunBundle = buildBundle({
      bundleId: "bundle-response-drift-rerun",
      mode: "feedback_rerun",
      runId: "run-response-drift-rerun",
      finalResponse:
        "The customer file is missing valid proof of address. Proof of address remains mandatory. Disposition: hold_for_document_collection.",
      outputArtifacts: ["artifact-policy"],
      feedbackIds: ["feedback-1"]
    });

    const metric = new ResponseQualityDriftScorer().score(rerunBundle, baselineBundle, {
      currentDomainCorrectnessScore: 1,
      baselineDomainCorrectnessScore: 1,
      currentFeedbackIntegrationScore: 0.95,
      baselineFeedbackIntegrationScore: 0
    });

    expect(metric).not.toBeNull();
    expect(metric?.metricFamily).toBe("response_quality_drift");
    expect(metric?.score).toBeGreaterThan(0.9);
    expect(metric?.details).toMatchObject({
      classification: "quality_preserving_variation",
      deltas: {
        outcomeScoreDelta: 0,
        domainCorrectnessDelta: 0,
        feedbackIntegrationDelta: 0.95,
        evidenceGroundingDelta: 0,
        requiredFindingsRecallDelta: 0,
        escalationDecisionDelta: 0
      }
    });
  });

  it("classifies degraded reruns as combined drift when outcome and trajectory regress", () => {
    const baselineBundle = buildBundle({
      bundleId: "bundle-response-drift-initial-2",
      mode: "initial",
      runId: "run-response-drift-initial-2",
      finalResponse:
        "The customer file is missing valid proof of address. Disposition: hold_for_document_collection.",
      outputArtifacts: ["artifact-policy"]
    });
    const rerunBundle = buildBundle({
      bundleId: "bundle-response-drift-rerun-2",
      mode: "feedback_rerun",
      runId: "run-response-drift-rerun-2",
      finalResponse: "The file can proceed after manual review.",
      outputArtifacts: [],
      feedbackIds: ["feedback-1"],
      agentMetadata: {
        memoryWritesSkipped: [
          {
            candidateId: "candidate-1",
            summary: "Proof of address remains required.",
            source: "user",
            scope: "case",
            rationale: "Skipped incorrectly."
          }
        ]
      }
    });

    const metric = new ResponseQualityDriftScorer().score(rerunBundle, baselineBundle, {
      currentDomainCorrectnessScore: 0.2,
      baselineDomainCorrectnessScore: 1,
      currentFeedbackIntegrationScore: 0.1,
      baselineFeedbackIntegrationScore: 0
    });

    expect(metric?.score).toBeLessThan(0.35);
    expect(metric?.passed).toBe(false);
    expect(metric?.details).toMatchObject({
      classification: "combined_drift"
    });
  });
});

type BuildBundleOptions = {
  bundleId: string;
  mode: "initial" | "feedback_rerun";
  runId: string;
  finalResponse: string;
  outputArtifacts: string[];
  feedbackIds?: string[];
  agentMetadata?: Record<string, unknown>;
};

function buildBundle(options: BuildBundleOptions) {
  return runBundleSchema.parse({
    bundleId: options.bundleId,
    example: {
      exampleId: "example-response-drift",
      variantGroupId: "variant-response-drift",
      taskType: "compliance",
      task: "Review the customer file.",
      skills: [],
      data: [],
      feedbackTurns: [
        {
          feedbackId: "feedback-1",
          turnId: "turn-2",
          source: "reviewer",
          summary: "Keep the block in place and cite the proof-of-address policy.",
          instructions: ["Retain the hold disposition."],
          correctedFacts: ["Proof of address remains mandatory."],
          priority: "high",
          resolution: "pending"
        }
      ],
      evaluationSpec: {
        instruction: "Review the customer file.",
        minimumCorrectnessThreshold: 0.8,
        requiredFindings: [
          "The customer file is missing valid proof of address."
        ],
        expectedEvidenceRefs: ["artifact-policy"],
        expectedDisposition: "hold_for_document_collection",
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
    feedbackIds: options.feedbackIds ?? [],
    finalResponse: options.finalResponse,
    outputArtifacts: options.outputArtifacts,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    },
    agentMetadata: options.agentMetadata ?? {},
    trace: null,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent"
  });
}

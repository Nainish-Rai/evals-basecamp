import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { FeedbackIntegrationScorer } from "../../../src/evals/trace-first/evaluation/feedback-integration-scorer.js";

describe("FeedbackIntegrationScorer", () => {
  it("scores reruns against feedback content and baseline behavior", () => {
    const initialBundle = runBundleSchema.parse({
      bundleId: "bundle-feedback-initial",
      example: {
        example_id: "example-feedback-1",
        variation_group_id: "variant-feedback-1",
        task_type: "compliance",
        task: {
          text: "Review the package.",
          images: []
        },
        instructions: "Review the package.",
        workspace: []
      },
      mode: "initial",
      runId: "run-feedback-initial",
      runBatchId: "batch-feedback-1",
      traceId: null,
      feedbackTurns: [
        {
          feedbackId: "feedback-1",
          turnId: "turn-2",
          source: "reviewer",
          summary: "The first draft missed the proof-of-address requirement.",
          instructions: [
            "Update the final finding to include the missing document."
          ],
          correctedFacts: [
            "Proof of address is mandatory for this customer type."
          ],
          priority: "high",
          resolution: "pending"
        }
      ],
      evaluationContext: {
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
      },
      feedbackIds: [],
      finalResponse: "Disposition: hold_for_document_collection.",
      outputArtifacts: ["artifact-policy"],
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      },
      agentMetadata: {},
      trace: null,
      collectedAt: "2026-03-28T00:00:00.000Z",
      agentLabel: "tool_chain",
      modelLabel: "local-scenario-agent"
    });
    const rerunBundle = runBundleSchema.parse({
      ...initialBundle,
      bundleId: "bundle-feedback-rerun",
      mode: "feedback_rerun",
      runId: "run-feedback-rerun",
      feedbackIds: ["feedback-1"],
      finalResponse:
        "The customer file is missing valid proof of address. Update the final finding to include the missing document. Proof of address is mandatory for this customer type. Disposition: hold_for_document_collection."
    });

    const metric = new FeedbackIntegrationScorer().score(
      rerunBundle,
      initialBundle
    );

    expect(metric?.metricFamily).toBe("feedback_integration");
    expect(metric?.score).toBeGreaterThan(0.8);
    expect(metric?.passed).toBe(true);
  });
});

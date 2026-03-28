import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { DomainCorrectnessScorer } from "../../../src/evals/trace-first/evaluation/domain-correctness-scorer.js";

describe("DomainCorrectnessScorer", () => {
  it("returns a metric with separate outcome coverage details", () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-domain-1",
      example: {
        example_id: "example-domain-1",
        variation_group_id: "variant-domain-1",
        task_type: "compliance",
        task: {
          text: "Review the package.",
          images: []
        },
        instructions: "Review the package.",
        workspace: []
      },
      mode: "initial",
      runId: "run-domain-1",
      runBatchId: "batch-domain-1",
      traceId: null,
      feedbackTurns: [],
      evaluationContext: {
        minimumCorrectnessThreshold: 0.8,
        requiredFindings: [
          "The customer file is missing valid proof of address."
        ],
        expectedEvidenceRefs: ["artifact-policy"],
        correctnessExpectation:
          "Identify the missing proof-of-address requirement and block progression.",
        expectedDisposition: "hold_for_document_collection",
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 0,
          toolDefinitionTokens: 0
        }
      },
      feedbackIds: [],
      finalResponse:
        "The customer file is missing valid proof of address. Disposition: hold_for_document_collection.",
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

    const metric = new DomainCorrectnessScorer().score(bundle);

    expect(metric.metricFamily).toBe("domain_correctness");
    expect(metric.score).toBe(1);
    expect(metric.passed).toBe(true);
    expect(metric.details).toMatchObject({
      findingCoverage: 1,
      evidenceCoverage: 1,
      dispositionScore: 1
    });
  });
});

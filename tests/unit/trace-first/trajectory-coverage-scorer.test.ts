import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { TrajectoryCoverageScorer } from "../../../src/evals/trace-first/evaluation/trajectory-coverage-scorer.js";

describe("TrajectoryCoverageScorer", () => {
  it("scores required steps, critical tools, and delegations from observed trajectory evidence", () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-trajectory-1",
      example: {
        exampleId: "example-trajectory-1",
        variantGroupId: "variant-trajectory-1",
        taskType: "workspace",
        task: "Review the investigation case.",
        skills: [],
        data: [],
        evaluationSpec: {
          instruction: "Review the investigation case.",
          minimumCorrectnessThreshold: 0.8,
          requiredFindings: [],
          expectedEvidenceRefs: [],
          trajectory: {
            requiredSteps: [
              "retrieveContext",
              "delegateInvestigation",
              "composeFinalAnswer"
            ],
            criticalTools: ["timeline_lookup"],
            criticalDelegations: ["delegateInvestigation"],
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
      mode: "initial",
      runId: "run-trajectory-1",
      traceId: "trace-trajectory-1",
      feedbackIds: [],
      finalResponse: "Completed the investigation review.",
      outputArtifacts: [],
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      },
      agentMetadata: {
        graphPath: [
          "retrieveContext",
          "delegateInvestigation",
          "delegateInvestigation",
          "composeFinalAnswer",
          "archiveWorkspace"
        ],
        toolCalls: [
          {
            toolName: "timeline_lookup"
          }
        ],
        subagentEvents: [
          {
            subagentId: "delegateInvestigation",
            taskSummary: "delegateInvestigation",
            status: "completed"
          }
        ]
      },
      trace: null,
      collectedAt: "2026-03-28T00:00:00.000Z",
      agentLabel: "workspace",
      modelLabel: "local-scenario-agent"
    });

    const metric = new TrajectoryCoverageScorer().score(bundle);

    expect(metric.metricFamily).toBe("trajectory");
    expect(metric.score).toBeGreaterThan(0.7);
    expect(metric.details).toMatchObject({
      requiredStepCoverage: 1,
      criticalToolCoverage: 1,
      delegationAlignment: 1,
      extraStepCount: 1,
      duplicateStepCount: 1
    });
  });
});

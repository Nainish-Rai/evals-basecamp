import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { AgentEvalsTrajectoryScorer } from "../../../src/evals/trace-first/evaluation/agentevals-trajectory-scorer.js";

describe("AgentEvalsTrajectoryScorer", () => {
  it("matches an authored partial trajectory using superset mode", async () => {
    const bundle = buildBundle({
      bundleId: "bundle-agentevals-trajectory-1",
      graphPath: [
        "planToolWork",
        "executeTool",
        "applyFeedback",
        "composeFinalAnswer"
      ],
      toolNames: ["policy_search", "customer_lookup"]
    });

    const metric = await new AgentEvalsTrajectoryScorer().score(bundle);

    expect(metric).not.toBeNull();
    expect(metric?.metricFamily).toBe("trajectory");
    expect(metric?.score).toBe(1);
    expect(metric?.details).toMatchObject({
      evaluator: "agentevals",
      trajectoryMatchMode: "superset"
    });
  });

  it("fails an exact trajectory when a required step is missing", async () => {
    const bundle = buildBundle({
      bundleId: "bundle-agentevals-trajectory-2",
      allowedStepFlexibility: "exact",
      allowAdditionalSteps: false,
      graphPath: ["planToolWork", "composeFinalAnswer"],
      toolNames: ["policy_search"]
    });

    const metric = await new AgentEvalsTrajectoryScorer().score(bundle);

    expect(metric?.score).toBe(0);
    expect(metric?.passed).toBe(false);
    expect(metric?.details).toMatchObject({
      trajectoryMatchMode: "strict"
    });
  });
});

type BuildBundleOptions = {
  bundleId: string;
  allowedStepFlexibility?: "exact" | "partial" | "unordered";
  allowAdditionalSteps?: boolean;
  graphPath: string[];
  toolNames: string[];
};

function buildBundle(options: BuildBundleOptions) {
  return runBundleSchema.parse({
    bundleId: options.bundleId,
    example: {
      exampleId: "example-agentevals-trajectory",
      variantGroupId: "variant-agentevals-trajectory",
      taskType: "compliance",
      task: "Review the customer file.",
      skills: [],
      data: [],
      evaluationSpec: {
        instruction: "Review the customer file.",
        minimumCorrectnessThreshold: 0.8,
        requiredFindings: [],
        expectedEvidenceRefs: [],
        trajectory: {
          requiredSteps: [
            "planToolWork",
            "executeTool",
            "composeFinalAnswer"
          ],
          criticalTools: ["policy_search"],
          criticalDelegations: [],
          allowedStepFlexibility: options.allowedStepFlexibility ?? "partial",
          allowAdditionalSteps: options.allowAdditionalSteps ?? true
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
    runId: `${options.bundleId}-run`,
    traceId: null,
    feedbackIds: [],
    finalResponse: "Completed the review.",
    outputArtifacts: [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    },
    agentMetadata: {
      graphPath: options.graphPath,
      toolCalls: options.toolNames.map((toolName) => ({ toolName }))
    },
    trace: null,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "tool_chain",
    modelLabel: "local-scenario-agent"
  });
}

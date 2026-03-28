import { describe, expect, it } from "vitest";

import { ContextEfficiencyScorer } from "../../../src/evals/trace-first/evaluation/context-efficiency-scorer.js";
import { HeuristicEvaluationJudge } from "../../../src/evals/trace-first/evaluation/heuristic-evaluation-judge.js";
import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";

describe("ContextEfficiencyScorer", () => {
  it("fails closed when a referenced subagent is missing from the trace", async () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-1",
      example: {
        exampleId: "example-1",
        variantGroupId: "variant-1",
        taskType: "risk",
        task: "Review the risk case.",
        skills: [],
        data: [],
        evaluationSpec: {
          instruction: "Review the risk case.",
          minimumCorrectnessThreshold: 0.75,
          requiredFindings: [],
          expectedEvidenceRefs: [],
          memoryCheckpoints: [],
          contextCheckpoints: [],
          staticOverhead: {
            systemPromptTokens: 200,
            toolDefinitionTokens: 100
          }
        }
      },
      mode: "initial",
      feedbackIds: [],
      finalResponse: "Disposition: maintain_high_residual_risk.",
      outputArtifacts: [],
      tokenUsage: {
        inputTokens: 800,
        outputTokens: 100,
        totalTokens: 900
      },
      agentMetadata: {
        toolCalls: [],
        contextMetrics: {
          retrievedContextTokens: 120,
          unusedContextTokens: 10,
          subagentCommunicationTokens: 60
        },
        subagentEvents: [
          {
            subagentId: "subagent-1",
            taskSummary: "Delegate the register update",
            status: "completed"
          }
        ]
      },
      trace: {
        traceId: "trace-1",
        enabled: true,
        traceName: "scenario_run",
        status: "completed",
        startedAt: "2026-03-28T00:00:00.000Z",
        endedAt: "2026-03-28T00:01:00.000Z",
        metadata: {},
        scores: [],
        spans: [],
        events: [],
        vendorTraceIds: []
      },
      collectedAt: "2026-03-28T00:01:00.000Z",
      agentLabel: "workspace",
      modelLabel: "local-scenario-agent"
    });

    const result = await new ContextEfficiencyScorer(
      new HeuristicEvaluationJudge()
    ).score(bundle, 0.9);

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.participantContextScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: "subagent-1",
          complete: false,
          score: 0
        })
      ])
    );
  });
});

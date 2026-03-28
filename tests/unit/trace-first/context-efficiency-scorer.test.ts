import { describe, expect, it } from "vitest";

import { ContextEfficiencyScorer } from "../../../src/evals/trace-first/evaluation/context-efficiency-scorer.js";
import { HeuristicEvaluationJudge } from "../../../src/evals/trace-first/evaluation/heuristic-evaluation-judge.js";
import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";

describe("ContextEfficiencyScorer", () => {
  it("fails closed when a referenced subagent is missing from the trace", async () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-1",
      example: {
        example_id: "example-1",
        variation_group_id: "variant-1",
        task_type: "risk",
        task: {
          text: "Review the risk case.",
          images: []
        },
        instructions: "Review the risk case.",
        workspace: []
      },
      mode: "initial",
      runId: "run-1",
      runBatchId: "batch-1",
      traceId: "trace-1",
      feedbackTurns: [],
      evaluationContext: {
        minimumCorrectnessThreshold: 0.75,
        requiredFindings: [],
        expectedEvidenceRefs: [],
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 200,
          toolDefinitionTokens: 100
        }
      },
      feedbackIds: [],
      finalResponse: "Disposition: maintain_high_residual_risk.",
      outputArtifacts: [],
      tokenUsage: {
        inputTokens: 800,
        outputTokens: 100,
        totalTokens: 900
      },
      agentMetadata: {
        toolSpecsCreated: [
          {
            toolName: "policy_search",
            description: "Searches policy context relevant to risk work."
          },
          {
            toolName: "policy_search",
            description: "Searches policy context relevant to risk work."
          }
        ],
        toolCalls: [],
        contextMetrics: {
          relevantContextTokens: 80,
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
    expect(result.diagnostics).toMatchObject({
      contextPrecision: 0.6667,
      systemPromptTokenOverhead: 200,
      toolDefinitionTokenOverhead: 100,
      duplicateToolDefinitionRate: 0.5
    });
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

  it("surfaces static context and tool-surface diagnostics", async () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-2",
      example: {
        example_id: "example-2",
        variation_group_id: "variant-2",
        task_type: "compliance",
        task: {
          text: "Review the compliance case.",
          images: []
        },
        instructions: "Review the compliance case.",
        workspace: []
      },
      mode: "initial",
      runId: "run-2",
      runBatchId: "batch-2",
      traceId: "trace-2",
      feedbackTurns: [],
      evaluationContext: {
        minimumCorrectnessThreshold: 0.75,
        requiredFindings: [],
        expectedEvidenceRefs: [],
        requiredContext: ["kyc onboarding checklist", "proof of address policy"],
        optionalContext: ["customer risk tier summary"],
        distractorContext: ["legacy screening note"],
        duplicateContext: ["duplicated checklist extract"],
        staleContext: ["superseded branch guidance"],
        expectedActiveTools: ["policy_search"],
        overlappingToolNames: ["customer_lookup"],
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 180,
          toolDefinitionTokens: 120
        }
      },
      feedbackIds: [],
      finalResponse: "The proof of address policy is mandatory for onboarding.",
      outputArtifacts: ["artifact-policy"],
      tokenUsage: {
        inputTokens: 900,
        outputTokens: 100,
        totalTokens: 1000
      },
      agentMetadata: {
        toolSpecsCreated: [
          {
            toolName: "policy_search",
            description: "Search policy context relevant to compliance work."
          },
          {
            toolName: "customer_lookup",
            description: "Retrieves compliance evidence needed for the current case."
          }
        ],
        toolCalls: [
          {
            toolName: "policy_search",
            status: "succeeded",
            inputArtifactRefs: ["artifact-policy"],
            outputArtifactRefs: ["artifact-policy"]
          }
        ],
        contextMetrics: {
          relevantContextTokens: 60,
          retrievedContextTokens: 80,
          unusedContextTokens: 20,
          subagentCommunicationTokens: 0
        }
      },
      trace: null,
      collectedAt: "2026-03-28T00:02:00.000Z",
      agentLabel: "tool_chain",
      modelLabel: "local-scenario-agent"
    });

    const result = await new ContextEfficiencyScorer(
      new HeuristicEvaluationJudge()
    ).score(bundle, 0.9);

    expect(result.diagnostics).toMatchObject({
      contextPrecision: 0.75,
      activeToolSurfaceArea: 1,
      unusedToolDefinitionRatio: 0,
      toolOverlapRate: 1,
      artifactReuseRate: 1
    });
    expect(result.diagnostics.duplicateContextRate).toBeGreaterThan(0);
    expect(result.diagnostics.contextBloatIndex).toBeGreaterThan(0.35);
  });
});

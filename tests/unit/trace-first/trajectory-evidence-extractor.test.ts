import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { createTrajectoryEvidenceSnapshot } from "../../../src/evals/trace-first/evaluation/trajectory-evidence-extractor.js";

describe("trajectory-evidence-extractor", () => {
  it("falls back to trace spans when graph path metadata is absent", () => {
    const bundle = buildBundle({
      agentMetadata: {
        toolCalls: [
          {
            toolName: "policy_search"
          }
        ],
        subagentEvents: [
          {
            subagentId: "delegateSubagent",
            taskSummary: "delegateSubagent"
          }
        ]
      },
      trace: {
        traceId: "trace-trajectory-1",
        enabled: true,
        traceName: "scenario_run",
        status: "completed",
        startedAt: "2026-03-28T00:00:00.000Z",
        endedAt: "2026-03-28T00:01:00.000Z",
        metadata: {},
        scores: [],
        spans: [
          {
            spanId: "span-1",
            parentSpanId: null,
            name: "planToolWork",
            kind: "graph_node",
            status: "completed",
            startedAt: "2026-03-28T00:00:01.000Z",
            endedAt: "2026-03-28T00:00:02.000Z",
            metadata: {},
            scores: [],
            errorMessage: null
          },
          {
            spanId: "span-2",
            parentSpanId: "span-1",
            name: "policy_search",
            kind: "tool",
            status: "completed",
            startedAt: "2026-03-28T00:00:02.000Z",
            endedAt: "2026-03-28T00:00:03.000Z",
            metadata: {
              toolName: "policy_search"
            },
            scores: [],
            errorMessage: null
          },
          {
            spanId: "span-3",
            parentSpanId: "span-2",
            name: "delegateSubagent",
            kind: "subagent_call",
            status: "completed",
            startedAt: "2026-03-28T00:00:03.000Z",
            endedAt: "2026-03-28T00:00:04.000Z",
            metadata: {
              subagentId: "delegateSubagent",
              taskSummary: "delegateSubagent"
            },
            scores: [],
            errorMessage: null
          }
        ],
        events: [],
        vendorTraceIds: []
      }
    });

    const snapshot = createTrajectoryEvidenceSnapshot(bundle);

    expect(snapshot.observed.graphPath).toEqual([
      "planToolWork",
      "policy_search",
      "delegateSubagent"
    ]);
    expect(snapshot.observed.toolNames).toEqual(["policy_search"]);
    expect(snapshot.observed.delegationIds).toEqual(["delegateSubagent"]);
    expect(snapshot.observed.traceSpanCount).toBe(3);
  });
});

function buildBundle(options: {
  agentMetadata: Record<string, unknown>;
  trace: Record<string, unknown>;
}) {
  return runBundleSchema.parse({
    bundleId: "bundle-trajectory-evidence-1",
    example: {
      exampleId: "example-trajectory-evidence-1",
      variantGroupId: "variant-trajectory-evidence-1",
      taskType: "workspace",
      task: "Validate the workspace trajectory.",
      skills: [],
      data: [],
      feedbackTurns: [],
      evaluationSpec: {
        instruction: "Validate the workspace trajectory.",
        minimumCorrectnessThreshold: 0.8,
        requiredFindings: [],
        expectedEvidenceRefs: [],
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 0,
          toolDefinitionTokens: 0
        }
      }
    },
    mode: "initial",
    runId: "run-trajectory-evidence-1",
    traceId: "trace-trajectory-1",
    feedbackIds: [],
    finalResponse: "Trajectory validated.",
    outputArtifacts: [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    },
    agentMetadata: options.agentMetadata,
    trace: options.trace,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent"
  });
}

import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { HeuristicEvaluationJudge } from "../../../src/evals/trace-first/evaluation/heuristic-evaluation-judge.js";
import { MemoryUtilizationScorer } from "../../../src/evals/trace-first/evaluation/memory-utilization-scorer.js";

describe("MemoryUtilizationScorer", () => {
  it("aggregates memory evidence into precision, recall, abstention, and impact signals", async () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-memory-1",
      example: {
        exampleId: "example-memory-1",
        variantGroupId: "variant-memory-1",
        taskType: "workspace",
        task: "Review the workspace handoff.",
        skills: [],
        data: [],
        evaluationSpec: {
          instruction: "Review the workspace handoff.",
          minimumCorrectnessThreshold: 0.8,
          requiredFindings: [],
          expectedEvidenceRefs: [],
          memoryCheckpoints: [
            {
              checkpointId: "checkpoint-1",
              description: "The rerun should reuse the saved approval note."
            },
            {
              checkpointId: "checkpoint-2",
              description: "The stale note should stay out of the rerun."
            }
          ],
          contextCheckpoints: [],
          staticOverhead: {
            systemPromptTokens: 0,
            toolDefinitionTokens: 0
          }
        }
      },
      mode: "feedback_rerun",
      runId: "run-memory-1",
      traceId: "trace-memory-1",
      feedbackIds: [],
      finalResponse: "The approval note was reused and the stale note was skipped.",
      outputArtifacts: [],
      tokenUsage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150
      },
      agentMetadata: {
        memoryCandidatesObserved: [
          {
            candidateId: "candidate-1",
            summary: "Approval note captured during the initial run."
          },
          {
            candidateId: "candidate-2",
            summary: "Stale note from the old process."
          }
        ],
        memoryWrites: [
          {
            candidateId: "candidate-1",
            summary: "Approval note captured during the initial run.",
            source: "user",
            scope: "case",
            rationale: "The rerun needs the approval note."
          }
        ],
        memoryWritesSkipped: [
          {
            candidateId: "candidate-2",
            summary: "Stale note from the old process.",
            source: "pattern",
            scope: "case",
            rationale: "The rerun should not persist stale context."
          }
        ],
        memoryReads: [
          {
            candidateId: "candidate-1",
            summary: "Approval note captured during the initial run.",
            source: "user",
            scope: "case",
            neededNow: true,
            usedInDecision: true,
            impact: "positive"
          },
          {
            candidateId: "candidate-2",
            summary: "Stale note from the old process.",
            source: "pattern",
            scope: "case",
            neededNow: false,
            usedInDecision: false,
            impact: "neutral"
          }
        ]
      },
      trace: {
        traceId: "trace-memory-1",
        enabled: true,
        traceName: "scenario_run",
        status: "completed",
        startedAt: "2026-03-28T00:00:00.000Z",
        endedAt: "2026-03-28T00:01:00.000Z",
        metadata: {},
        scores: [],
        spans: [],
        events: [
          {
            eventId: "event-1",
            parentSpanId: null,
            name: "memory.observed_candidate",
            recordedAt: "2026-03-28T00:00:10.000Z",
            metadata: {
              candidateId: "candidate-1",
              summary: "Approval note captured during the initial run."
            }
          },
          {
            eventId: "event-2",
            parentSpanId: null,
            name: "memory.saved",
            recordedAt: "2026-03-28T00:00:11.000Z",
            metadata: {
              candidateId: "candidate-1",
              summary: "Approval note captured during the initial run."
            }
          },
          {
            eventId: "event-3",
            parentSpanId: null,
            name: "memory.used_in_decision",
            recordedAt: "2026-03-28T00:00:12.000Z",
            metadata: {
              candidateId: "candidate-1",
              summary: "Approval note captured during the initial run."
            }
          }
        ],
        vendorTraceIds: []
      },
      collectedAt: "2026-03-28T00:01:00.000Z",
      agentLabel: "workspace",
      modelLabel: "local-scenario-agent"
    });

    const result = await new MemoryUtilizationScorer(
      new HeuristicEvaluationJudge()
    ).score(bundle);

    expect(result.state).toBe("correct_save_correct_needed_retrieval");
    expect(result.score).toBeGreaterThan(0.68);
    expect(result.metricResult.metricFamily).toBe("memory_utilization");
    expect(result.metricResult.details).toMatchObject({
      counts: {
        observedCandidates: 2,
        writes: 1,
        skippedWrites: 1,
        reads: 2,
        usedReads: 1,
        checkpointCount: 2
      },
        writePrecision: 1,
        writeRecall: 0.5,
        readPrecision: 0.5,
        readRecall: 0.5,
        abstentionPrecision: 0.5,
        abstentionRecall: 0.5,
        impactScore: 1,
        penalties: {
          irrelevantRetrieval: 0.5,
          missedNeededRetrieval: 0.5,
          missedNeededWrite: 0.5,
          wastefulSave: 0,
          harmfulMemoryActivation: 0
        }
      });
    expect(result.metricResult.details.evidence).toMatchObject({
      usedWriteCandidateIds: ["candidate-1"],
      usedReadCandidateIds: ["candidate-1"],
      skippedWriteCandidateIds: ["candidate-2"]
    });
  });

  it("keeps abstention strong when no shared memory is needed", async () => {
    const bundle = runBundleSchema.parse({
      bundleId: "bundle-memory-2",
      example: {
        exampleId: "example-memory-2",
        variantGroupId: "variant-memory-2",
        taskType: "risk",
        task: "Review the risk memo.",
        skills: [],
        data: [],
        evaluationSpec: {
          instruction: "Review the risk memo.",
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
      runId: "run-memory-2",
      traceId: null,
      feedbackIds: [],
      finalResponse: "No shared memory was needed for this memo.",
      outputArtifacts: [],
      tokenUsage: {
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60
      },
      agentMetadata: {},
      trace: null,
      collectedAt: "2026-03-28T00:02:00.000Z",
      agentLabel: "tool_chain",
      modelLabel: "local-scenario-agent"
    });

    const result = await new MemoryUtilizationScorer(
      new HeuristicEvaluationJudge()
    ).score(bundle);

    expect(result.state).toBe("correct_abstention_from_saving");
    expect(result.metricResult.details.counts).toMatchObject({
      observedCandidates: 0,
      writes: 0,
      skippedWrites: 0,
      reads: 0,
      usedReads: 0
    });
    expect(result.score).toBeGreaterThan(0.9);
  });
});

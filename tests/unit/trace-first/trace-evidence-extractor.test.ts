import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import {
  compareTraceEvidence,
  createTraceEvidenceSnapshot
} from "../../../src/evals/trace-first/evaluation/trace-evidence-extractor.js";

describe("trace-evidence-extractor", () => {
  it("normalizes trace and metadata evidence into outcome, memory, and escalation snapshots", () => {
    const bundle = buildBundle({
      bundleId: "bundle-trace-evidence-1",
      runId: "run-trace-evidence-1",
      finalResponse:
        "The customer file is missing valid proof of address. Disposition: escalate_to_compliance_officer.",
      agentMetadata: {
        groundedEvidenceRefs: ["artifact-policy-kyc"],
        memoryCandidatesObserved: [
          {
            candidateId: "memory-proof-of-address",
            summary: "Proof of address is mandatory for this customer type."
          }
        ],
        memoryWrites: [
          {
            candidateId: "memory-proof-of-address",
            summary: "Proof of address is mandatory for this customer type.",
            source: "user",
            scope: "case",
            rationale: "The reviewer corrected the first draft."
          }
        ],
        memoryWritesSkipped: [
          {
            candidateId: "memory-spurious",
            summary: "A noisy detail that should not be stored.",
            source: "pattern",
            scope: "step",
            rationale: "The note is not reusable."
          }
        ],
        memoryReads: [
          {
            candidateId: "memory-proof-of-address",
            summary: "Proof of address is mandatory for this customer type.",
            source: "user",
            scope: "case",
            neededNow: true,
            usedInDecision: true,
            impact: "positive"
          }
        ]
      },
      outputArtifacts: ["artifact-policy-kyc"],
      trace: {
        traceId: "trace-trace-evidence-1",
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
            name: "memory.saved",
            recordedAt: "2026-03-28T00:00:01.000Z",
            metadata: {
              candidateId: "memory-proof-of-address",
              summary: "Proof of address is mandatory for this customer type.",
              source: "user",
              scope: "case",
              rationale: "The reviewer corrected the first draft."
            }
          },
          {
            eventId: "event-2",
            parentSpanId: null,
            name: "memory.retrieved",
            recordedAt: "2026-03-28T00:00:02.000Z",
            metadata: {
              candidateId: "memory-proof-of-address",
              summary: "Proof of address is mandatory for this customer type."
            }
          },
          {
            eventId: "event-3",
            parentSpanId: null,
            name: "memory.used_in_decision",
            recordedAt: "2026-03-28T00:00:03.000Z",
            metadata: {
              candidateId: "memory-proof-of-address",
              summary: "Proof of address is mandatory for this customer type."
            }
          }
        ],
        vendorTraceIds: []
      }
    });

    const snapshot = createTraceEvidenceSnapshot(bundle);

    expect(snapshot.outcome).toMatchObject({
      requiredFindingRecall: 1,
      evidenceRecall: 1,
      matchedRequiredFindings: [
        "The customer file is missing valid proof of address."
      ],
      matchedEvidenceRefs: ["artifact-policy-kyc"]
    });
    expect(snapshot.escalation).toMatchObject({
      expectedDisposition: "escalate_to_compliance_officer",
      dispositionMatched: true,
      inferredDecision: "escalate",
      decisionMentioned: true
    });
    expect(snapshot.memory).toMatchObject({
      observedCandidateIds: ["memory-proof-of-address"],
      savedCandidateIds: ["memory-proof-of-address"],
      skippedSaveCandidateIds: ["memory-spurious"],
      retrievedCandidateIds: ["memory-proof-of-address"],
      usedCandidateIds: ["memory-proof-of-address"],
      sources: ["user", "pattern"],
      scopes: ["case", "step"],
      traceEventNames: [
        "memory.saved",
        "memory.retrieved",
        "memory.used_in_decision"
      ],
      traceEventCount: 3
    });
  });

  it("compares paired runs with outcome, evidence, and memory deltas", () => {
    const baseline = buildBundle({
      bundleId: "bundle-trace-evidence-baseline",
      runId: "run-trace-evidence-baseline",
      finalResponse: "The case is missing context and requires more review.",
      agentMetadata: {
        groundedEvidenceRefs: [],
        memoryWrites: [],
        memoryWritesSkipped: [],
        memoryReads: []
      }
    });
    const current = buildBundle({
      bundleId: "bundle-trace-evidence-current",
      runId: "run-trace-evidence-current",
      finalResponse:
        "The customer file is missing valid proof of address. Disposition: escalate_to_compliance_officer.",
      agentMetadata: {
        groundedEvidenceRefs: ["artifact-policy-kyc"],
        memoryWrites: [
          {
            candidateId: "memory-proof-of-address",
            summary: "Proof of address is mandatory for this customer type.",
            source: "user",
            scope: "case",
            rationale: "The reviewer corrected the first draft."
          }
        ],
        memoryWritesSkipped: [],
        memoryReads: [
          {
            candidateId: "memory-proof-of-address",
            summary: "Proof of address is mandatory for this customer type.",
            source: "user",
            scope: "case",
            neededNow: true,
            usedInDecision: true,
            impact: "positive"
          }
        ]
      },
      outputArtifacts: ["artifact-policy-kyc"]
    });

    const comparison = compareTraceEvidence(current, baseline);

    expect(comparison).toMatchObject({
      currentRunId: "run-trace-evidence-current",
      baselineRunId: "run-trace-evidence-baseline",
      requiredFindingRecallDelta: 1,
      evidenceRecallDelta: 1,
      dispositionMatchDelta: 1,
      savedCandidateDelta: 1,
      retrievedCandidateDelta: 1,
      usedCandidateDelta: 1,
      skippedSaveDelta: 0,
      skippedRetrievalDelta: 0,
      decisionChanged: true,
      currentDecision: "escalate",
      baselineDecision: "unknown"
    });
  });
});

type BuildBundleOptions = {
  bundleId: string;
  runId: string;
  finalResponse: string;
  agentMetadata: Record<string, unknown>;
  outputArtifacts?: string[];
  trace?: unknown;
};

function buildBundle(options: BuildBundleOptions) {
  return runBundleSchema.parse({
    bundleId: options.bundleId,
    example: {
      exampleId: "example-trace-evidence",
      variantGroupId: "variant-trace-evidence",
      taskType: "compliance",
      task: "Review the case.",
      skills: [],
      data: [],
      feedbackTurns: [],
      evaluationSpec: {
        instruction: "Review the case.",
        minimumCorrectnessThreshold: 0.8,
        requiredFindings: [
          "The customer file is missing valid proof of address."
        ],
        expectedEvidenceRefs: ["artifact-policy-kyc"],
        expectedDisposition: "escalate_to_compliance_officer",
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 0,
          toolDefinitionTokens: 0
        }
      }
    },
    mode: "feedback_rerun",
    runId: options.runId,
    traceId: "trace-trace-evidence",
    feedbackIds: [],
    finalResponse: options.finalResponse,
    outputArtifacts: options.outputArtifacts ?? [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    },
    agentMetadata: options.agentMetadata,
    trace: options.trace ?? null,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent"
  });
}

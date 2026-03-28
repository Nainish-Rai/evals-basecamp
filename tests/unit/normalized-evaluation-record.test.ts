import { describe, expect, it } from "vitest";

import { normalizedEvaluationRecordSchema } from "../../src/evals/contracts/normalized-evaluation-record.js";

describe("normalizedEvaluationRecordSchema", () => {
  it("accepts a record with retrieval, memory, and subagent detail", () => {
    const record = normalizedEvaluationRecordSchema.parse({
      scenarioId: "scenario-compliance-001",
      runId: "run-001",
      agentFamily: "workspace",
      taskFamily: "governance",
      turnId: "turn-2",
      inputTask: "Review the case and update the finding after feedback.",
      feedbackInputs: ["feedback-proof-of-address"],
      finalResponse: "The case is missing proof of address and should be escalated.",
      groundedEvidenceRefs: ["artifact-policy-kyc"],
      toolSpecsCreated: [
        {
          toolName: "policy_search",
          description: "Searches the policy corpus",
          inputSchemaSummary: "query: string",
          reusedExistingTool: true
        }
      ],
      toolCalls: [
        {
          callId: "tool-call-1",
          toolName: "policy_search",
          status: "succeeded",
          latencyMs: 14,
          inputSummary: "query=proof of address requirement",
          outputSummary: "Returned the matching KYC policy section.",
          consumedBudget: 1,
          contextTokensUsed: 120,
          inputArtifactRefs: ["artifact-policy-kyc"],
          outputArtifactRefs: ["artifact-policy-kyc"]
        }
      ],
      budgetLedger: [
        {
          budgetName: "tool_calls",
          scope: "run",
          allocated: 5,
          consumed: 1,
          remaining: 4,
          unit: "tools",
          withinBudget: true
        }
      ],
      retrievalEvents: [
        {
          retrievalId: "retrieval-1",
          sourceId: "customer-db",
          query: "proof of address requirement",
          latencyMs: 11,
          candidateCount: 3,
          selectedCount: 1,
          retrievedTokenCount: 240,
          relevantTokenCount: 180,
          selectedArtifactRefs: ["artifact-policy-kyc"],
          relevantArtifactRefs: ["artifact-policy-kyc"],
          usedArtifactRefs: ["artifact-policy-kyc"]
        }
      ],
      filesystemArtifacts: [
        {
          artifactId: "workspace-summary",
          path: "workspace/case/summary.md",
          kind: "workspace",
          tokenCount: 80
        }
      ],
      subagentEvents: [
        {
          subagentId: "subagent-1",
          model: "openai:gpt-5.4-mini",
          modelTier: "small",
          taskSummary: "Summarize the retrieved KYC evidence.",
          status: "completed"
        }
      ],
      memoryCandidatesObserved: [
        {
          candidateId: "memory-opportunity-proof-of-address",
          summary: "Proof of address is mandatory for this customer type."
        }
      ],
      memoryReads: [
        {
          candidateId: "memory-opportunity-proof-of-address",
          summary: "Proof of address is mandatory for this customer type.",
          source: "user",
          scope: "case",
          neededNow: true,
          usedInDecision: true,
          impact: "positive"
        }
      ],
      memoryWrites: [
        {
          candidateId: "memory-opportunity-proof-of-address",
          summary: "Proof of address is mandatory for this customer type.",
          source: "user",
          scope: "case",
          rationale: "The reviewer corrected the first draft."
        }
      ],
      memoryWritesSkipped: [],
      memorySources: ["user"],
      memoryScopes: ["case"],
      memoryWorthKeeping: ["memory-opportunity-proof-of-address"],
      memoryRetrieved: ["memory-opportunity-proof-of-address"],
      memoryNeededNow: ["memory-opportunity-proof-of-address"],
      memoryUsedInDecision: ["memory-opportunity-proof-of-address"],
      memoryImpact: "positive",
      memoryFailureTypes: [],
      trajectory: {
        requiredSteps: ["planCase", "retrieveContext", "composeFinalAnswer"],
        criticalTools: ["policy_search"],
        criticalDelegations: [],
        allowedStepFlexibility: "partial",
        allowAdditionalSteps: true
      },
      graphPath: ["planCase", "retrieveContext", "applyFeedback", "composeFinalAnswer"],
      latencyMs: 1200,
      contextMetrics: {
        contextWindowSizeTokens: 128000,
        promptTokens: 2200,
        retrievedContextTokens: 500,
        relevantContextTokens: 420,
        unusedContextTokens: 80,
        workspaceArtifactTokens: 80,
        subagentCommunicationTokens: 60
      },
      tokenUsage: {
        inputTokens: 2200,
        outputTokens: 300,
        totalTokens: 2500,
        cachedInputTokens: 0
      },
      langfuseTraceId: null
    });

    expect(record.memoryImpact).toBe("positive");
    expect(record.subagentEvents[0]?.modelTier).toBe("small");
  });

  it("rejects invalid budget accounting", () => {
    const result = normalizedEvaluationRecordSchema.safeParse({
      scenarioId: "scenario-compliance-001",
      runId: "run-001",
      agentFamily: "tool_chain",
      taskFamily: "compliance",
      turnId: "turn-1",
      inputTask: "Review the case.",
      finalResponse: "Done.",
      budgetLedger: [
        {
          budgetName: "tool_calls",
          scope: "run",
          allocated: 2,
          consumed: 3,
          remaining: 0,
          unit: "tools",
          withinBudget: false
        }
      ],
      contextMetrics: {
        contextWindowSizeTokens: 128000,
        promptTokens: 100,
        retrievedContextTokens: 0,
        relevantContextTokens: 0,
        unusedContextTokens: 0,
        workspaceArtifactTokens: 0,
        subagentCommunicationTokens: 0
      },
      trajectory: {
        requiredSteps: [],
        criticalTools: [],
        criticalDelegations: [],
        allowedStepFlexibility: "partial",
        allowAdditionalSteps: true
      },
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 0
      },
      latencyMs: 20,
      langfuseTraceId: null
    });

    expect(result.success).toBe(false);
  });

  it("accepts milestone 6 tool-chain outputs with failed and skipped calls", () => {
    const result = normalizedEvaluationRecordSchema.safeParse({
      scenarioId: "scenario-risk-002",
      runId: "run-risk-002",
      agentFamily: "tool_chain",
      taskFamily: "risk",
      turnId: "turn-1",
      inputTask: "Score the inherent risk and explain ambiguity-driven retries.",
      finalResponse: "The customer maps to high inherent risk and the retry came from tool ambiguity.",
      groundedEvidenceRefs: ["artifact-risk-002-matrix"],
      toolSpecsCreated: [
        {
          toolName: "risk_score_lookup",
          description: "Retrieves risk evidence needed for the current case.",
          inputSchemaSummary: "recordId?: string, query?: string",
          reusedExistingTool: true
        },
        {
          toolName: "glossary_search",
          description: "Retrieves risk evidence needed for the current case.",
          inputSchemaSummary: "query: string",
          reusedExistingTool: true
        }
      ],
      toolCalls: [
        {
          callId: "tool-call-1",
          toolName: "risk_score_lookup",
          status: "succeeded",
          latencyMs: 14,
          inputSummary: "tool=risk_score_lookup",
          outputSummary: "Mapped the exposure score to the inherent risk matrix.",
          consumedBudget: 1,
          contextTokensUsed: 110,
          inputArtifactRefs: ["artifact-risk-002-matrix"],
          outputArtifactRefs: ["artifact-risk-002-matrix"]
        },
        {
          callId: "tool-call-2",
          toolName: "glossary_search",
          status: "failed",
          latencyMs: 17,
          inputSummary: "tool=glossary_search",
          outputSummary: "Ambiguous tool framing caused a retry without introducing new facts.",
          consumedBudget: 1,
          contextTokensUsed: 125,
          inputArtifactRefs: ["artifact-risk-002-matrix"],
          outputArtifactRefs: []
        },
        {
          callId: "tool-call-3",
          toolName: "policy_search",
          status: "skipped",
          latencyMs: 0,
          inputSummary: "tool=policy_search",
          outputSummary: "Skipped because the tool-call budget was exhausted.",
          consumedBudget: 0,
          contextTokensUsed: 0,
          inputArtifactRefs: ["artifact-risk-002-matrix"],
          outputArtifactRefs: []
        }
      ],
      budgetLedger: [
        {
          budgetName: "tool_calls",
          scope: "run",
          allocated: 2,
          consumed: 2,
          remaining: 0,
          unit: "tools",
          withinBudget: true
        },
        {
          budgetName: "prompt_tokens",
          scope: "run",
          allocated: 2000,
          consumed: 670,
          remaining: 1330,
          unit: "tokens",
          withinBudget: true
        }
      ],
      contextMetrics: {
        contextWindowSizeTokens: 128000,
        promptTokens: 670,
        retrievedContextTokens: 235,
        relevantContextTokens: 205,
        unusedContextTokens: 30,
        workspaceArtifactTokens: 0,
        subagentCommunicationTokens: 0
      },
      memoryImpact: null,
      trajectory: {
        requiredSteps: ["planCase", "retrieveContext", "composeFinalAnswer"],
        criticalTools: ["risk_score_lookup"],
        criticalDelegations: [],
        allowedStepFlexibility: "partial",
        allowAdditionalSteps: true
      },
      tokenUsage: {
        inputTokens: 905,
        outputTokens: 92,
        totalTokens: 997,
        cachedInputTokens: 0
      },
      latencyMs: 88,
      langfuseTraceId: "trace-risk-002"
    });

    expect(result.success).toBe(true);
  });
});

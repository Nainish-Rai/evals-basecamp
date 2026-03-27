import { describe, expect, it } from "vitest";

import { scenarioSchema } from "../../src/domain/scenarios/scenario-schema.js";

describe("scenarioSchema", () => {
  it("accepts a valid feedback-aware compliance scenario", () => {
    const scenario = scenarioSchema.parse({
      scenarioId: "scenario-compliance-001",
      title: "Missing KYC evidence review",
      agentFamily: "tool_chain",
      taskFamily: "compliance",
      difficulty: "medium",
      modalityProfile: ["text", "pdf"],
      caseBrief: "Review the case and identify missing KYC evidence.",
      environmentSeed: "seed-001",
      artifacts: [
        {
          artifactId: "policy-1",
          kind: "policy",
          title: "KYC policy",
          path: "policies/kyc-policy.pdf",
          mimeType: "application/pdf"
        }
      ],
      availableDataSources: [
        {
          sourceId: "customer-db",
          kind: "database",
          description: "Synthetic customer records"
        }
      ],
      availableTools: ["policy_search", "customer_lookup"],
      syntheticPackReferences: [
        {
          referenceId: "pack-ref-compliance-core",
          packId: "pack-compliance-core-v2",
          entryIds: ["compliance-entry-01"],
          purpose: "Load reusable KYC source material.",
          materializationTargets: ["artifacts", "data_sources"],
          destinationPath: "workspace/reference"
        }
      ],
      materialization: {
        workspaceRoot: "workspace/case",
        includeScenarioArtifacts: true,
        syntheticPackReferenceOrder: ["pack-ref-compliance-core"]
      },
      expectedOutcomes: [
        {
          findingId: "finding-1",
          summary: "Customer proof of address is missing.",
          severity: "high",
          requiredEvidenceRefs: ["policy-1"],
          requiredPolicyRefs: ["kyc.section.4"]
        }
      ],
      contextEvaluationSpec: {
        minimumCorrectnessThreshold: 0.8,
        systemPromptProfile: {
          fixedTokenOverhead: 180,
          dynamicTokenOverhead: 80
        },
        toolSurfaceProfile: {
          expectedActiveTools: ["policy_search", "customer_lookup"],
          overlappingToolNames: [],
          duplicateToolRisk: "low",
          toolDefinitionTokenOverhead: 120,
          ambiguityHotspots: []
        },
        requiredContext: ["kyc.section.4"],
        optionalContext: ["customer risk tier"],
        distractorContext: [],
        duplicateContext: [],
        staleContext: [],
        contextScenarioType: "minimal_sufficient_context",
        agentRenderingNotes: {
          toolChain:
            "Use the policy search and customer lookup tools directly.",
          workspace:
            "Curate only the required checklist data into the workspace."
        },
        multimodalOptimizationExpectations: [],
        fileReadCleanupExpectations: []
      },
      driftEvaluationSpec: {
        expectedOutcomeCriteria: {
          correctnessExpectation:
            "Identify the missing proof-of-address requirement and block progression.",
          requiredFindings: ["finding-1"],
          requiredEvidenceRefs: ["policy-1"],
          expectedDisposition: "hold_for_document_collection"
        },
        trajectory: {
          requiredSteps: ["planToolWork", "executeTool", "composeFinalAnswer"],
          criticalTools: ["policy_search"],
          criticalDelegations: []
        },
        allowedStepFlexibility: "partial",
        driftCriticality: "outcome_only_drift",
        baselineComparisonMode: "baseline_relative_comparison"
      },
      trajectoryHints: {
        expectedNodes: ["planToolWork", "executeTool", "composeFinalAnswer"],
        expectedTools: ["policy_search"],
        allowAdditionalSteps: true
      },
      feedbackTurns: [
        {
          feedbackId: "feedback-1",
          turnId: "turn-2",
          source: "reviewer",
          summary: "You missed the proof-of-address requirement.",
          instructions: [
            "Re-check the KYC document checklist before finalizing."
          ],
          correctedFacts: [
            "Proof of address is mandatory for this customer type."
          ],
          priority: "high",
          resolution: "pending"
        }
      ],
      memoryTargets: [
        {
          targetId: "memory-1",
          description: "Retain the corrected proof-of-address requirement.",
          mustRetainAfterFeedback: true
        }
      ],
      memoryEvaluationSpec: {
        memorySources: ["user"],
        memoryScope: "case",
        memoryOpportunities: [
          {
            opportunityId: "memory-opportunity-proof-of-address",
            summary: "Store the corrected proof-of-address rule for the rerun.",
            source: "user",
            scope: "case",
            worthKeeping: true,
            neededLater: true,
            relatedTurnIds: ["turn-2"]
          }
        ],
        memoryCheckpoints: [
          {
            checkpointId: "memory-checkpoint-rerun",
            turnId: "turn-2",
            expectedAction: "retrieve",
            relatedOpportunityIds: ["memory-opportunity-proof-of-address"],
            rationale: "The rerun needs the reviewer correction."
          }
        ],
        expectedMemoryState: "correct_save_correct_needed_retrieval",
        expectedMemoryImpact: "positive"
      },
      evaluationRubric: {
        requiredChecks: ["identify_missing_document", "cite_policy_source"],
        optionalChecks: ["recommend_escalation"],
        prohibitedFailures: ["hallucinated_document"]
      },
      failureModes: ["missed_required_document"]
    });

    expect(scenario.feedbackTurns).toHaveLength(1);
    expect(scenario.expectedOutcomes[0]?.severity).toBe("high");
    expect(scenario.syntheticPackReferences).toHaveLength(1);
    expect(scenario.memoryEvaluationSpec?.expectedMemoryState).toBe(
      "correct_save_correct_needed_retrieval"
    );
  });

  it("rejects scenarios without expected outcomes", () => {
    const result = scenarioSchema.safeParse({
      scenarioId: "scenario-invalid-001",
      title: "Invalid scenario",
      agentFamily: "workspace",
      taskFamily: "risk",
      difficulty: "easy",
      modalityProfile: ["text"],
      caseBrief: "No expected outcomes.",
      environmentSeed: "seed-invalid",
      contextEvaluationSpec: {
        minimumCorrectnessThreshold: 0.8,
        systemPromptProfile: {
          fixedTokenOverhead: 1,
          dynamicTokenOverhead: 1
        },
        toolSurfaceProfile: {
          expectedActiveTools: [],
          overlappingToolNames: [],
          duplicateToolRisk: "low",
          toolDefinitionTokenOverhead: 0,
          ambiguityHotspots: []
        },
        requiredContext: ["risk.section.1"],
        optionalContext: [],
        distractorContext: [],
        duplicateContext: [],
        staleContext: [],
        contextScenarioType: "minimal_sufficient_context",
        agentRenderingNotes: {
          toolChain: "Use minimal context.",
          workspace: "Use minimal context."
        },
        multimodalOptimizationExpectations: [],
        fileReadCleanupExpectations: []
      },
      driftEvaluationSpec: {
        expectedOutcomeCriteria: {
          correctnessExpectation: "Produce a risk finding.",
          requiredFindings: ["finding-risk"],
          requiredEvidenceRefs: [],
          expectedDisposition: "document_risk"
        },
        trajectory: {
          requiredSteps: ["composeFinalAnswer"],
          criticalTools: [],
          criticalDelegations: []
        },
        allowedStepFlexibility: "partial",
        driftCriticality: "combined_drift",
        baselineComparisonMode: "absolute_rubric_scoring"
      },
      evaluationRubric: {
        requiredChecks: ["something"]
      },
      expectedOutcomes: []
    });

    expect(result.success).toBe(false);
  });
});

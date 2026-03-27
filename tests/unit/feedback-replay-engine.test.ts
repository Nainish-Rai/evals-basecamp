import { describe, expect, it } from "vitest";

import { FeedbackReplayEngine } from "../../src/runtime/runner/feedback-replay-engine.js";
import { scenarioSchema } from "../../src/domain/scenarios/scenario-schema.js";

describe("FeedbackReplayEngine", () => {
  it("creates an initial run and a feedback rerun when feedback exists", () => {
    const scenario = scenarioSchema.parse({
      scenarioId: "scenario-feedback-001",
      title: "Feedback-aware test scenario",
      agentFamily: "tool_chain",
      taskFamily: "compliance",
      difficulty: "easy",
      modalityProfile: ["text"],
      caseBrief: "Validate the execution plan.",
      environmentSeed: "seed-feedback-001",
      availableTools: ["policy_search"],
      expectedOutcomes: [
        {
          findingId: "finding-feedback-001",
          summary: "A valid finding exists.",
          severity: "medium"
        }
      ],
      contextEvaluationSpec: {
        minimumCorrectnessThreshold: 0.7,
        systemPromptProfile: {
          fixedTokenOverhead: 10,
          dynamicTokenOverhead: 5
        },
        toolSurfaceProfile: {
          expectedActiveTools: ["policy_search"],
          overlappingToolNames: [],
          duplicateToolRisk: "low",
          toolDefinitionTokenOverhead: 10,
          ambiguityHotspots: []
        },
        requiredContext: ["policy clause"],
        optionalContext: [],
        distractorContext: [],
        duplicateContext: [],
        staleContext: [],
        contextScenarioType: "minimal_sufficient_context",
        agentRenderingNotes: {
          toolChain: "Use direct policy search.",
          workspace: "Curate the policy clause into the workspace."
        },
        multimodalOptimizationExpectations: [],
        fileReadCleanupExpectations: []
      },
      driftEvaluationSpec: {
        expectedOutcomeCriteria: {
          correctnessExpectation: "Return the required finding.",
          requiredFindings: ["finding-feedback-001"],
          requiredEvidenceRefs: [],
          expectedDisposition: "document_finding"
        },
        trajectory: {
          requiredSteps: ["composeFinalAnswer"],
          criticalTools: ["policy_search"],
          criticalDelegations: []
        },
        allowedStepFlexibility: "partial",
        driftCriticality: "outcome_only_drift",
        baselineComparisonMode: "absolute_rubric_scoring"
      },
      trajectoryHints: {
        expectedNodes: ["composeFinalAnswer"],
        requiredSteps: [],
        expectedTools: ["policy_search"],
        criticalDelegations: [],
        allowAdditionalSteps: true
      },
      feedbackTurns: [
        {
          feedbackId: "feedback-001",
          turnId: "turn-2",
          source: "reviewer",
          summary: "Incorporate the missing policy clause.",
          instructions: ["Apply the correction."],
          correctedFacts: ["The policy clause is mandatory."],
          priority: "high",
          resolution: "pending"
        }
      ],
      evaluationRubric: {
        requiredChecks: ["return_required_finding"]
      }
    });
    const replayEngine = new FeedbackReplayEngine();

    const executionPlans = replayEngine.planExecutions(scenario);

    expect(executionPlans).toHaveLength(2);
    expect(executionPlans[0]).toEqual({
      mode: "initial",
      feedbackTurns: []
    });
    expect(executionPlans[1]?.mode).toBe("feedback_rerun");
    expect(executionPlans[1]?.feedbackTurns[0]?.feedbackId).toBe(
      "feedback-001"
    );
  });
});

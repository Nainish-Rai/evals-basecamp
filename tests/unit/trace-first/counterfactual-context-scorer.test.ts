import { describe, expect, it } from "vitest";

import { runBundleSchema } from "../../../src/evals/trace-first/contracts/run-bundle-schema.js";
import { ContextCounterfactualScorer } from "../../../src/evals/trace-first/evaluation/context-counterfactual-scorer.js";

describe("ContextCounterfactualScorer", () => {
  it("derives counterfactual metrics from the current context footprint", () => {
    const bundle = buildBundle({
      bundleId: "bundle-counterfactual-context-1",
      runId: "run-counterfactual-context-1",
      finalResponse: "The hold disposition remains in place.",
      requiredContext: [
        "kyc section 4 proof of address requirement",
        "customer address checklist"
      ],
      optionalContext: ["customer risk tier summary"],
      distractorContext: ["legacy screening note"],
      duplicateContext: ["duplicated checklist extract"],
      staleContext: ["superseded branch guidance"],
      contextMetrics: {
        contextWindowSizeTokens: 512,
        promptTokens: 220,
        retrievedContextTokens: 120,
        relevantContextTokens: 78,
        unusedContextTokens: 18,
        workspaceArtifactTokens: 12,
        subagentCommunicationTokens: 20
      }
    });

    const scorer = new ContextCounterfactualScorer();
    const metrics = scorer.score({
      bundle,
      accuracyScore: 0.87,
      retrievedContextTokens: 120,
      relevantContextTokens: 78,
      unusedContextTokens: 18,
      handoffPromptTokens: 20,
      fileReadRedundancyRate: 0.25,
      contextPrecision: 0.65,
      contextRecall: 0.81,
      contextBloatIndex: 0.32
    });

    expect(metrics).toMatchObject({
      minimalSufficientContextTokens: expect.any(Number),
      currentContextTokens: expect.any(Number),
      removableContextTokens: expect.any(Number),
      ablationLossPerArtifact: expect.any(Number),
      progressiveContextGain: expect.any(Number),
      contextSaturationPointTokens: expect.any(Number),
      budgetConstrainedRobustness: expect.any(Number),
      contextInheritanceRedundancy: expect.any(Number)
    });
    expect(metrics.minimalSufficientContextTokens).toBeLessThanOrEqual(
      metrics.currentContextTokens
    );
    expect(metrics.removableContextTokens).toBeGreaterThan(0);
    expect(metrics.contextSaturationPointTokens).toBeGreaterThanOrEqual(
      metrics.minimalSufficientContextTokens
    );
    expect(metrics.budgetConstrainedRobustness).toBeGreaterThan(0);
  });

  it("compares current and baseline metrics deterministically", () => {
    const scorer = new ContextCounterfactualScorer();
    const baseline = scorer.score({
      bundle: buildBundle({
        bundleId: "bundle-counterfactual-context-baseline",
        runId: "run-counterfactual-context-baseline",
        finalResponse: "Baseline run.",
        requiredContext: [
          "kyc section 4 proof of address requirement",
          "customer address checklist",
          "customer risk tier summary"
        ],
        optionalContext: ["legacy screening note"],
        distractorContext: ["legacy screening note"],
        duplicateContext: ["duplicated checklist extract"],
        staleContext: ["superseded branch guidance"],
        contextMetrics: {
          contextWindowSizeTokens: 480,
          promptTokens: 260,
          retrievedContextTokens: 140,
          relevantContextTokens: 54,
          unusedContextTokens: 30,
          workspaceArtifactTokens: 12,
          subagentCommunicationTokens: 40
        }
      }),
      accuracyScore: 0.71,
      retrievedContextTokens: 140,
      relevantContextTokens: 54,
      unusedContextTokens: 30,
      handoffPromptTokens: 40,
      fileReadRedundancyRate: 0.35,
      contextPrecision: 0.39,
      contextRecall: 0.62,
      contextBloatIndex: 0.48
    });
    const current = scorer.score({
      bundle: buildBundle({
        bundleId: "bundle-counterfactual-context-current",
        runId: "run-counterfactual-context-current",
        finalResponse: "Current run.",
        requiredContext: [
          "kyc section 4 proof of address requirement",
          "customer address checklist"
        ],
        optionalContext: ["customer risk tier summary"],
        distractorContext: ["legacy screening note"],
        duplicateContext: ["duplicated checklist extract"],
        staleContext: ["superseded branch guidance"],
        contextMetrics: {
          contextWindowSizeTokens: 512,
          promptTokens: 200,
          retrievedContextTokens: 110,
          relevantContextTokens: 72,
          unusedContextTokens: 12,
          workspaceArtifactTokens: 8,
          subagentCommunicationTokens: 18
        }
      }),
      accuracyScore: 0.87,
      retrievedContextTokens: 110,
      relevantContextTokens: 72,
      unusedContextTokens: 12,
      handoffPromptTokens: 18,
      fileReadRedundancyRate: 0.22,
      contextPrecision: 0.65,
      contextRecall: 0.81,
      contextBloatIndex: 0.32
    });

    const comparison = scorer.compare(current, baseline);

    expect(comparison.scoreDelta).toBeGreaterThan(0);
    expect(comparison.currentContextTokensDelta).toBeLessThan(0);
    expect(comparison.minimalSufficientContextTokensDelta).toBeLessThan(0);
    expect(comparison.contextInheritanceRedundancyDelta).toBeLessThan(0);
  });
});

type BuildBundleOptions = {
  bundleId: string;
  runId: string;
  finalResponse: string;
  requiredContext: string[];
  optionalContext: string[];
  distractorContext: string[];
  duplicateContext: string[];
  staleContext: string[];
  contextMetrics: {
    contextWindowSizeTokens: number;
    promptTokens: number;
    retrievedContextTokens: number;
    relevantContextTokens: number;
    unusedContextTokens: number;
    workspaceArtifactTokens: number;
    subagentCommunicationTokens: number;
  };
};

function buildBundle(options: BuildBundleOptions) {
  return runBundleSchema.parse({
    bundleId: options.bundleId,
    example: {
      exampleId: "example-counterfactual-context",
      variantGroupId: "variant-counterfactual-context",
      taskType: "compliance",
      task: "Review the customer onboarding case.",
      skills: [],
      data: [],
      evaluationSpec: {
        instruction: "Review the customer onboarding case.",
        minimumCorrectnessThreshold: 0.8,
        requiredContext: options.requiredContext,
        optionalContext: options.optionalContext,
        distractorContext: options.distractorContext,
        duplicateContext: options.duplicateContext,
        staleContext: options.staleContext,
        requiredFindings: [],
        expectedEvidenceRefs: [],
        memoryCheckpoints: [],
        contextCheckpoints: [],
        staticOverhead: {
          systemPromptTokens: 180,
          toolDefinitionTokens: 120
        }
      }
    },
    mode: "initial",
    runId: options.runId,
    traceId: null,
    feedbackIds: [],
    finalResponse: options.finalResponse,
    outputArtifacts: [],
    tokenUsage: {
      inputTokens: 720,
      outputTokens: 90,
      totalTokens: 810
    },
    agentMetadata: {
      contextMetrics: options.contextMetrics
    },
    trace: null,
    collectedAt: "2026-03-28T00:00:00.000Z",
    agentLabel: "workspace",
    modelLabel: "local-scenario-agent"
  });
}

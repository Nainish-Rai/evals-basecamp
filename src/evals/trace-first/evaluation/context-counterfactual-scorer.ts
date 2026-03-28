import type { RunBundle } from "../contracts/run-bundle-schema.js";

export type CounterfactualContextMetrics = {
  minimalSufficientContextTokens: number;
  currentContextTokens: number;
  removableContextTokens: number;
  ablationLossPerArtifact: number;
  progressiveContextGain: number;
  contextSaturationPointTokens: number;
  budgetConstrainedRobustness: number;
  contextInheritanceRedundancy: number;
};

export type CounterfactualContextComparison = {
  scoreDelta: number;
  minimalSufficientContextTokensDelta: number;
  currentContextTokensDelta: number;
  removableContextTokensDelta: number;
  ablationLossPerArtifactDelta: number;
  progressiveContextGainDelta: number;
  contextSaturationPointTokensDelta: number;
  budgetConstrainedRobustnessDelta: number;
  contextInheritanceRedundancyDelta: number;
};

export class ContextCounterfactualScorer {
  score(options: {
    bundle: RunBundle;
    accuracyScore: number;
    retrievedContextTokens: number;
    relevantContextTokens: number;
    unusedContextTokens: number;
    handoffPromptTokens: number;
    fileReadRedundancyRate: number;
    contextPrecision: number;
    contextRecall: number;
    contextBloatIndex: number;
  }): CounterfactualContextMetrics {
    const evaluationSpec = options.bundle.example.evaluationSpec;
    const requiredContextTokens = estimateTokenCount(
      evaluationSpec.requiredContext.join(" ")
    );
    const optionalContextTokens = estimateTokenCount(
      evaluationSpec.optionalContext.join(" ")
    );
    const distractorContextTokens = estimateTokenCount(
      [
        ...evaluationSpec.distractorContext,
        ...evaluationSpec.duplicateContext,
        ...evaluationSpec.staleContext
      ].join(" ")
    );
    const staticOverheadTokens =
      evaluationSpec.staticOverhead.systemPromptTokens +
      evaluationSpec.staticOverhead.toolDefinitionTokens;
    const minimalSufficientContextTokens =
      staticOverheadTokens + requiredContextTokens;
    const currentContextTokens =
      staticOverheadTokens +
      options.retrievedContextTokens +
      options.handoffPromptTokens;
    const removableContextTokens =
      distractorContextTokens + options.unusedContextTokens;
    const artifactCount = Math.max(
      evaluationSpec.requiredContext.length +
        evaluationSpec.optionalContext.length +
        evaluationSpec.distractorContext.length +
        evaluationSpec.duplicateContext.length +
        evaluationSpec.staleContext.length,
      1
    );
    const requiredContextShare =
      currentContextTokens === 0
        ? 0
        : requiredContextTokens / currentContextTokens;
    const progressiveContextGain = roundScore(
      Math.max(0, options.contextRecall - options.contextPrecision * 0.5) *
        Math.max(options.accuracyScore, 0.25)
    );
    const saturationHeadroom = roundScore(
      Math.min(
        1,
        optionalContextTokens / Math.max(requiredContextTokens + optionalContextTokens, 1)
      )
    );

    return {
      minimalSufficientContextTokens,
      currentContextTokens,
      removableContextTokens,
      ablationLossPerArtifact: roundScore(
        (requiredContextShare * Math.max(options.accuracyScore, options.contextRecall)) /
          artifactCount
      ),
      progressiveContextGain,
      contextSaturationPointTokens: Math.max(
        minimalSufficientContextTokens,
        Math.round(
          minimalSufficientContextTokens + optionalContextTokens * saturationHeadroom
        )
      ),
      budgetConstrainedRobustness: roundScore(
        1 - Math.max(options.contextBloatIndex, removableContextTokens / Math.max(currentContextTokens, 1)) * 0.6
      ),
      contextInheritanceRedundancy: roundScore(
        Math.max(
          options.fileReadRedundancyRate,
          options.handoffPromptTokens / Math.max(currentContextTokens, 1)
        )
      )
    };
  }

  compare(
    current: CounterfactualContextMetrics,
    baseline: CounterfactualContextMetrics
  ): CounterfactualContextComparison {
    return {
      scoreDelta: roundDelta(
        average([
          current.progressiveContextGain,
          current.budgetConstrainedRobustness,
          1 - current.ablationLossPerArtifact
        ]) -
          average([
            baseline.progressiveContextGain,
            baseline.budgetConstrainedRobustness,
            1 - baseline.ablationLossPerArtifact
          ])
      ),
      minimalSufficientContextTokensDelta:
        current.minimalSufficientContextTokens -
        baseline.minimalSufficientContextTokens,
      currentContextTokensDelta:
        current.currentContextTokens - baseline.currentContextTokens,
      removableContextTokensDelta:
        current.removableContextTokens - baseline.removableContextTokens,
      ablationLossPerArtifactDelta:
        current.ablationLossPerArtifact - baseline.ablationLossPerArtifact,
      progressiveContextGainDelta:
        current.progressiveContextGain - baseline.progressiveContextGain,
      contextSaturationPointTokensDelta:
        current.contextSaturationPointTokens - baseline.contextSaturationPointTokens,
      budgetConstrainedRobustnessDelta:
        current.budgetConstrainedRobustness - baseline.budgetConstrainedRobustness,
      contextInheritanceRedundancyDelta:
        current.contextInheritanceRedundancy - baseline.contextInheritanceRedundancy
    };
  }
}

function estimateTokenCount(text: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4));
}

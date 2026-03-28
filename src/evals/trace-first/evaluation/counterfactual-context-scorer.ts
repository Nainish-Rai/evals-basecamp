import { metricResultSchema, type MetricResult } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";

type ContextPhaseId =
  | "required_only"
  | "progressive_context"
  | "full_context"
  | "budget_constrained";

type ContextCounterfactualPhase = {
  phaseId: ContextPhaseId;
  tokenFootprint: number;
  score: number;
  marginalGain: number;
};

type CounterfactualComparison = {
  baselineBundleId: string;
  scoreDelta: number;
  minimalSufficientContextTokensDelta: number;
  marginalGainDelta: number;
  budgetRobustnessDelta: number;
  saturationPointTokensDelta: number;
};

export type CounterfactualContextDetails = {
  requiredContextTokens: number;
  optionalContextTokens: number;
  distractorContextTokens: number;
  duplicateContextTokens: number;
  staleContextTokens: number;
  staticPromptTokens: number;
  toolDefinitionTokens: number;
  totalContextFootprintTokens: number;
  contextWindowSizeTokens: number;
  contextBudgetUtilization: number;
  currentContextScore: number;
  requiredOnlyScore: number;
  progressiveContextScore: number;
  fullContextScore: number;
  budgetConstrainedScore: number;
  marginalGain: number;
  peakMarginalGain: number;
  minimalSufficientContextTokens: number;
  saturationPointTokens: number;
  ablationDeltaPerGroup: {
    requiredContext: number;
    optionalContext: number;
    distractorContext: number;
    duplicateContext: number;
    staleContext: number;
    staticPrompt: number;
    toolDefinition: number;
  };
  progressiveContextCurve: ContextCounterfactualPhase[];
  variantProfiles: string[];
  baselineComparison: CounterfactualComparison | null;
};

type ContextFootprint = {
  requiredContextTokens: number;
  optionalContextTokens: number;
  distractorContextTokens: number;
  duplicateContextTokens: number;
  staleContextTokens: number;
  staticPromptTokens: number;
  toolDefinitionTokens: number;
  contextWindowSizeTokens: number;
};

export class CounterfactualContextScorer {
  score(bundle: RunBundle): MetricResult;
  score(bundle: RunBundle, baselineBundle: RunBundle | null): MetricResult;
  score(bundle: RunBundle, baselineBundle: RunBundle | null = null): MetricResult {
    const details = buildContextDetails(bundle);
    const baselineDetails = baselineBundle ? buildContextDetails(baselineBundle) : null;
    const score = roundScore(
      average([
        details.currentContextScore,
        details.fullContextScore,
        details.budgetConstrainedScore,
        1 - clamp01(details.contextBudgetUtilization - 0.75)
      ])
    );
    const baselineComparison = buildBaselineComparison(
      baselineBundle,
      details,
      baselineDetails,
      score
    );

    return metricResultSchema.parse({
      metricId: `context-counterfactual:${bundle.bundleId}`,
      metricFamily: "context_counterfactual",
      score,
      passed: score >= Math.max(0.75, bundle.example.evaluationSpec.minimumCorrectnessThreshold * 0.9),
      summary: buildSummary(details, baselineComparison),
      details: {
        ...details,
        baselineComparison
      },
      evidenceRefs: []
    });
  }
}

function buildBaselineComparison(
  baselineBundle: RunBundle | null,
  details: CounterfactualContextDetails,
  baselineDetails: CounterfactualContextDetails | null,
  score: number
): CounterfactualComparison | null {
  if (!baselineBundle || !baselineDetails) {
    return null;
  }

  return {
    baselineBundleId: baselineBundle.bundleId,
    scoreDelta: roundDelta(score - baselineDetails.currentContextScore),
    minimalSufficientContextTokensDelta: roundDelta(
      details.minimalSufficientContextTokens -
        baselineDetails.minimalSufficientContextTokens
    ),
    marginalGainDelta: roundDelta(details.marginalGain - baselineDetails.marginalGain),
    budgetRobustnessDelta: roundDelta(
      details.budgetConstrainedScore - baselineDetails.budgetConstrainedScore
    ),
    saturationPointTokensDelta: roundDelta(
      details.saturationPointTokens - baselineDetails.saturationPointTokens
    )
  };
}

function buildContextDetails(bundle: RunBundle): CounterfactualContextDetails {
  const evaluationSpec = bundle.example.evaluationSpec;
  const footprint = buildContextFootprint(bundle);
  const requiredOnlyPhase = scorePhase(footprint, "required_only");
  const progressivePhase = scorePhase(footprint, "progressive_context");
  const fullPhase = scorePhase(footprint, "full_context");
  const budgetPhase = scorePhase(footprint, "budget_constrained");
  const progressiveContextCurve = [requiredOnlyPhase, progressivePhase, fullPhase, budgetPhase];
  const minimalSufficientContextTokens =
    findMinimalSufficientContextTokens(
      progressiveContextCurve,
      evaluationSpec.minimumCorrectnessThreshold
    ) ?? fullPhase.tokenFootprint;
  const saturationPointTokens = findSaturationPointTokens(progressiveContextCurve);
  const marginalGain = roundDelta(fullPhase.score - requiredOnlyPhase.score);
  const peakMarginalGain = roundDelta(
    Math.max(
      progressivePhase.score - requiredOnlyPhase.score,
      fullPhase.score - progressivePhase.score,
      budgetPhase.score - fullPhase.score
    )
  );

  return {
    requiredContextTokens: footprint.requiredContextTokens,
    optionalContextTokens: footprint.optionalContextTokens,
    distractorContextTokens: footprint.distractorContextTokens,
    duplicateContextTokens: footprint.duplicateContextTokens,
    staleContextTokens: footprint.staleContextTokens,
    staticPromptTokens: footprint.staticPromptTokens,
    toolDefinitionTokens: footprint.toolDefinitionTokens,
    totalContextFootprintTokens:
      footprint.requiredContextTokens +
      footprint.optionalContextTokens +
      footprint.distractorContextTokens +
      footprint.duplicateContextTokens +
      footprint.staleContextTokens +
      footprint.staticPromptTokens +
      footprint.toolDefinitionTokens,
    contextWindowSizeTokens: footprint.contextWindowSizeTokens,
    contextBudgetUtilization: clamp01(
      (footprint.requiredContextTokens +
        footprint.optionalContextTokens +
        footprint.distractorContextTokens +
        footprint.duplicateContextTokens +
        footprint.staleContextTokens +
        footprint.staticPromptTokens +
        footprint.toolDefinitionTokens) /
        Math.max(footprint.contextWindowSizeTokens, 1)
    ),
    currentContextScore: roundScore(
      average([
        requiredOnlyPhase.score,
        progressivePhase.score,
        fullPhase.score,
        1 - clamp01(
          (footprint.distractorContextTokens +
            footprint.duplicateContextTokens +
            footprint.staleContextTokens) /
            Math.max(
              footprint.requiredContextTokens + footprint.optionalContextTokens + 1,
              1
            )
        )
      ])
    ),
    requiredOnlyScore: requiredOnlyPhase.score,
    progressiveContextScore: progressivePhase.score,
    fullContextScore: fullPhase.score,
    budgetConstrainedScore: budgetPhase.score,
    marginalGain,
    peakMarginalGain,
    minimalSufficientContextTokens,
    saturationPointTokens,
    ablationDeltaPerGroup: {
      requiredContext: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, requiredContextTokens: 0 }, "full_context").score
      ),
      optionalContext: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, optionalContextTokens: 0 }, "full_context").score
      ),
      distractorContext: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, distractorContextTokens: 0 }, "full_context").score
      ),
      duplicateContext: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, duplicateContextTokens: 0 }, "full_context").score
      ),
      staleContext: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, staleContextTokens: 0 }, "full_context").score
      ),
      staticPrompt: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, staticPromptTokens: 0 }, "full_context").score
      ),
      toolDefinition: roundDelta(
        fullPhase.score - scorePhase({ ...footprint, toolDefinitionTokens: 0 }, "full_context").score
      )
    },
    progressiveContextCurve,
    variantProfiles: buildVariantProfiles(bundle),
    baselineComparison: null
  };
}

function buildContextFootprint(bundle: RunBundle): ContextFootprint {
  const evaluationSpec = bundle.example.evaluationSpec;
  const staticPromptTokens = evaluationSpec.staticOverhead.systemPromptTokens;
  const toolDefinitionTokens = evaluationSpec.staticOverhead.toolDefinitionTokens;
  const contextWindowSizeTokens = inferContextWindowSize(bundle);

  return {
    requiredContextTokens: estimateTokenCount(evaluationSpec.requiredContext.join(" ")),
    optionalContextTokens: estimateTokenCount(evaluationSpec.optionalContext.join(" ")),
    distractorContextTokens: estimateTokenCount(evaluationSpec.distractorContext.join(" ")),
    duplicateContextTokens: estimateTokenCount(evaluationSpec.duplicateContext.join(" ")),
    staleContextTokens: estimateTokenCount(evaluationSpec.staleContext.join(" ")),
    staticPromptTokens,
    toolDefinitionTokens,
    contextWindowSizeTokens
  };
}

function scorePhase(
  footprint: ContextFootprint,
  phaseId: ContextPhaseId
): ContextCounterfactualPhase {
  const requiredTokens = footprint.requiredContextTokens;
  const optionalTokens = footprint.optionalContextTokens;
  const noiseTokens =
    footprint.distractorContextTokens +
    footprint.duplicateContextTokens +
    footprint.staleContextTokens;
  const usefulTokens =
    phaseId === "required_only"
      ? requiredTokens
      : phaseId === "progressive_context"
        ? requiredTokens + Math.floor(optionalTokens * 0.6)
        : requiredTokens + optionalTokens;
  const phaseNoiseTokens =
    phaseId === "budget_constrained" ? Math.floor(noiseTokens * 0.75) : noiseTokens;
  const overheadTokens =
    footprint.staticPromptTokens + footprint.toolDefinitionTokens;
  const totalTokens = usefulTokens + phaseNoiseTokens + overheadTokens;
  const precision = clamp01(
    usefulTokens / Math.max(usefulTokens + phaseNoiseTokens, 1)
  );
  const recall = clamp01(usefulTokens / Math.max(requiredTokens, 1));
  const cleanliness = 1 - clamp01(phaseNoiseTokens / Math.max(totalTokens - overheadTokens, 1));
  const budgetFit = 1 - clamp01(totalTokens / Math.max(footprint.contextWindowSizeTokens, 1));
  const score = roundScore(
    average([
      precision,
      recall,
      cleanliness,
      budgetFit,
      1 - clamp01(overheadTokens / Math.max(footprint.contextWindowSizeTokens, 1))
    ])
  );
  const tokenFootprint = totalTokens;
  const marginalGain =
    phaseId === "required_only"
      ? 0
      : phaseId === "progressive_context"
        ? roundDelta(score - scorePhase(footprint, "required_only").score)
        : phaseId === "full_context"
          ? roundDelta(score - scorePhase(footprint, "progressive_context").score)
          : roundDelta(score - scorePhase(footprint, "full_context").score);

  return {
    phaseId,
    tokenFootprint,
    score,
    marginalGain
  };
}

function findMinimalSufficientContextTokens(
  phases: ContextCounterfactualPhase[],
  minimumCorrectnessThreshold: number
): number | null {
  const qualifyingPhase = phases.find((phase) => phase.score >= minimumCorrectnessThreshold);

  return qualifyingPhase ? qualifyingPhase.tokenFootprint : null;
}

function findSaturationPointTokens(phases: ContextCounterfactualPhase[]): number {
  for (let index = 1; index < phases.length; index += 1) {
    const previousPhase = phases[index - 1];
    const currentPhase = phases[index];

    if (!previousPhase || !currentPhase) {
      continue;
    }

    if (currentPhase.score - previousPhase.score <= 0.03) {
      return previousPhase.tokenFootprint;
    }
  }

  return phases.at(-1)?.tokenFootprint ?? 0;
}

function buildVariantProfiles(bundle: RunBundle): string[] {
  const evaluationSpec = bundle.example.evaluationSpec;
  const profiles = [
    "ablation",
    "progressive-context",
    "budget-constrained-rerun",
    evaluationSpec.distractorContext.length > 0 ? "distractor-injection" : null
  ];

  return [...new Set(profiles.filter((value): value is string => Boolean(value)))];
}

function inferContextWindowSize(bundle: RunBundle): number {
  const contextMetrics = (bundle.agentMetadata as { contextMetrics?: { contextWindowSizeTokens?: number } })
    .contextMetrics;
  return contextMetrics?.contextWindowSizeTokens ?? 128_000;
}

function buildSummary(
  details: CounterfactualContextDetails,
  baselineComparison: CounterfactualComparison | null
): string {
  const baselineSummary = baselineComparison
    ? `Baseline delta ${baselineComparison.scoreDelta}.`
    : "Baseline comparison unavailable.";

  return [
    `Context score ${details.currentContextScore}.`,
    `Minimal sufficient context ${details.minimalSufficientContextTokens} tokens.`,
    `Budget robustness ${details.budgetConstrainedScore}.`,
    baselineSummary
  ].join(" ");
}

function estimateTokenCount(value: string): number {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return 0;
  }

  return Math.ceil(normalizedValue.split(/\s+/).length * 1.3);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(clamp01(value).toFixed(4));
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4));
}

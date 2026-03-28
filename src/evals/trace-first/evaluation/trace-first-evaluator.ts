import {
  evaluatedExampleSchema,
  type EvaluatedExample
} from "../contracts/evaluated-example-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { AccuracyScorer } from "./accuracy-scorer.js";
import { ContextEfficiencyScorer } from "./context-efficiency-scorer.js";
import { DomainCorrectnessScorer } from "./domain-correctness-scorer.js";
import { DriftAggregator } from "./drift-aggregator.js";
import type { EvaluationJudge } from "./evaluation-judge.js";
import { FeedbackIntegrationScorer } from "./feedback-integration-scorer.js";
import { MemoryUtilizationScorer } from "./memory-utilization-scorer.js";

export type PeerEfficiencySummary = {
  taskType: string;
  accuracyBin: string;
  exampleCount: number;
  averageSystemPromptTokens: number;
  averageToolDefinitionTokens: number;
  averageMultimodalRawTokens: number;
  averageMultimodalCompressedTokens: number;
  averageContextScore: number;
  systemPromptVaguenessRetryRate: number;
};

export class TraceFirstEvaluator {
  private readonly accuracyScorer: AccuracyScorer;
  private readonly domainCorrectnessScorer: DomainCorrectnessScorer;
  private readonly feedbackIntegrationScorer: FeedbackIntegrationScorer;
  private readonly memoryScorer: MemoryUtilizationScorer;
  private readonly contextScorer: ContextEfficiencyScorer;
  private readonly driftAggregator: DriftAggregator;

  constructor(judge: EvaluationJudge) {
    this.accuracyScorer = new AccuracyScorer();
    this.domainCorrectnessScorer = new DomainCorrectnessScorer();
    this.feedbackIntegrationScorer = new FeedbackIntegrationScorer();
    this.memoryScorer = new MemoryUtilizationScorer(judge);
    this.contextScorer = new ContextEfficiencyScorer(judge);
    this.driftAggregator = new DriftAggregator();
  }

  async evaluate(runBundles: RunBundle[]): Promise<{
    examples: EvaluatedExample[];
    peerEfficiency: PeerEfficiencySummary[];
  }> {
    const initialBundlesByKey = new Map<string, RunBundle>(
      runBundles
        .filter((runBundle) => runBundle.mode === "initial")
        .map((runBundle) => [buildRunGroupKey(runBundle), runBundle])
    );
    const evaluatedExamples = this.driftAggregator.attach(
      await Promise.all(
        runBundles.map(async (runBundle) => {
          const accuracy = this.accuracyScorer.score(runBundle);
          const domainCorrectness =
            this.domainCorrectnessScorer.score(runBundle);
          const feedbackIntegration = this.feedbackIntegrationScorer.score(
            runBundle,
            runBundle.mode === "feedback_rerun"
              ? (initialBundlesByKey.get(buildRunGroupKey(runBundle)) ?? null)
              : null
          );
          const memory = await this.memoryScorer.score(runBundle);
          const context = await this.contextScorer.score(
            runBundle,
            accuracy.score
          );

          return evaluatedExampleSchema.parse({
            bundleId: runBundle.bundleId,
            exampleId: runBundle.example.exampleId,
            variantGroupId: runBundle.example.variantGroupId,
            runId: runBundle.runId,
            taskType: runBundle.example.taskType,
            mode: runBundle.mode,
            accuracyScore: accuracy.score,
            domainCorrectnessScore: domainCorrectness.score,
            feedbackIntegrationScore: feedbackIntegration?.score ?? 1,
            accuracyBin: accuracy.bin,
            memoryScore: memory.score,
            memoryState: memory.state,
            memoryPassed: memory.passed,
            contextScore: context.score,
            contextPassed: context.passed,
            retryAttribution: context.retryAttribution,
            peerMetrics: context.peerMetrics,
            participantContextScores: context.participantContextScores,
            contextDiagnostics: context.diagnostics,
            metricResults: [
              domainCorrectness,
              feedbackIntegration,
              memory.metricResult,
              {
                metricId: `context-efficiency:${runBundle.bundleId}`,
                metricFamily: "context_efficiency",
                score: context.score,
                passed: context.passed,
                summary: `Context efficiency score ${context.score}.`,
                details: {
                  diagnostics: context.diagnostics,
                  retryAttribution: context.retryAttribution,
                  participantContextScores: context.participantContextScores,
                  peerMetrics: context.peerMetrics
                },
                evidenceRefs: []
              }
            ].filter((metricResult) => metricResult !== null)
          });
        })
      )
    );

    return {
      examples: evaluatedExamples,
      peerEfficiency: summarizePeerEfficiency(evaluatedExamples)
    };
  }

  summarizeDrift(examples: EvaluatedExample[]) {
    return this.driftAggregator.summarize(examples);
  }
}

function buildRunGroupKey(bundle: RunBundle): string {
  return [
    bundle.example.exampleId,
    bundle.example.variantGroupId,
    bundle.agentLabel,
    bundle.modelLabel
  ].join("::");
}

function summarizePeerEfficiency(
  examples: EvaluatedExample[]
): PeerEfficiencySummary[] {
  const byKey = new Map<string, EvaluatedExample[]>();

  for (const example of examples) {
    const key = `${example.taskType}::${example.accuracyBin}`;
    const group = byKey.get(key) ?? [];
    group.push(example);
    byKey.set(key, group);
  }

  return [...byKey.entries()].map(([key, group]) => {
    const [taskType = "unknown", accuracyBin = "unknown"] = key.split("::");
    const exampleCount = group.length;

    return {
      taskType,
      accuracyBin,
      exampleCount,
      averageSystemPromptTokens: round(
        average(group.map((example) => example.peerMetrics.systemPromptTokens))
      ),
      averageToolDefinitionTokens: round(
        average(
          group.map((example) => example.peerMetrics.toolDefinitionTokens)
        )
      ),
      averageMultimodalRawTokens: round(
        average(group.map((example) => example.peerMetrics.multimodalRawTokens))
      ),
      averageMultimodalCompressedTokens: round(
        average(
          group.map((example) => example.peerMetrics.multimodalCompressedTokens)
        )
      ),
      averageContextScore: round(
        average(group.map((example) => example.contextScore))
      ),
      systemPromptVaguenessRetryRate: round(
        group.reduce(
          (total, example) =>
            total + example.retryAttribution.systemPromptVagueness,
          0
        ) /
          Math.max(
            group.reduce(
              (total, example) => total + example.peerMetrics.toolRetryCount,
              0
            ),
            1
          )
      )
    };
  });
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

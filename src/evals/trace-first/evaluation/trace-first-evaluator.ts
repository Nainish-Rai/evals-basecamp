import { evaluatedExampleSchema, type EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { AccuracyScorer } from "./accuracy-scorer.js";
import { ContextEfficiencyScorer } from "./context-efficiency-scorer.js";
import { DriftAggregator } from "./drift-aggregator.js";
import type { EvaluationJudge } from "./evaluation-judge.js";
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
  private readonly memoryScorer: MemoryUtilizationScorer;
  private readonly contextScorer: ContextEfficiencyScorer;
  private readonly driftAggregator: DriftAggregator;

  constructor(judge: EvaluationJudge) {
    this.accuracyScorer = new AccuracyScorer();
    this.memoryScorer = new MemoryUtilizationScorer(judge);
    this.contextScorer = new ContextEfficiencyScorer(judge);
    this.driftAggregator = new DriftAggregator();
  }

  async evaluate(runBundles: RunBundle[]): Promise<{
    examples: EvaluatedExample[];
    peerEfficiency: PeerEfficiencySummary[];
  }> {
    const evaluatedExamples = this.driftAggregator.attach(
      await Promise.all(runBundles.map(async (runBundle) => {
        const accuracy = this.accuracyScorer.score(runBundle);
        const memory = await this.memoryScorer.score(runBundle);
        const context = await this.contextScorer.score(runBundle, accuracy.score);

        return evaluatedExampleSchema.parse({
          exampleId: runBundle.example.exampleId,
          variantGroupId: runBundle.example.variantGroupId,
          taskType: runBundle.example.taskType,
          mode: runBundle.mode,
          accuracyScore: accuracy.score,
          accuracyBin: accuracy.bin,
          memoryScore: memory.score,
          memoryState: memory.state,
          memoryPassed: memory.passed,
          contextScore: context.score,
          contextPassed: context.passed,
          retryAttribution: context.retryAttribution,
          peerMetrics: context.peerMetrics,
          participantContextScores: context.participantContextScores
        });
      }))
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
        average(group.map((example) => example.peerMetrics.toolDefinitionTokens))
      ),
      averageMultimodalRawTokens: round(
        average(group.map((example) => example.peerMetrics.multimodalRawTokens))
      ),
      averageMultimodalCompressedTokens: round(
        average(group.map((example) => example.peerMetrics.multimodalCompressedTokens))
      ),
      averageContextScore: round(average(group.map((example) => example.contextScore))),
      systemPromptVaguenessRetryRate: round(
        group.reduce(
          (total, example) => total + example.retryAttribution.systemPromptVagueness,
          0
        ) / Math.max(group.reduce((total, example) => total + example.peerMetrics.toolRetryCount, 0), 1)
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

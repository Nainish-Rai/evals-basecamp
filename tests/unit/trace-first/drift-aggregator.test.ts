import { describe, expect, it } from "vitest";

import { DriftAggregator } from "../../../src/evals/trace-first/evaluation/drift-aggregator.js";
import { evaluatedExampleSchema } from "../../../src/evals/trace-first/contracts/evaluated-example-schema.js";

describe("DriftAggregator", () => {
  it("computes group-level drift summaries from memory and context scores", () => {
    const aggregator = new DriftAggregator();
    const examples = [
      createEvaluatedExample("example-1", "variant-a", 0.8, 0.7),
      createEvaluatedExample("example-2", "variant-a", 0.82, 0.72),
      createEvaluatedExample("example-3", "variant-b", 0.5, 0.4)
    ];

    const summaries = aggregator.summarize(examples);

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantGroupId: "variant-a",
          status: "passed",
          variantCount: 2
        }),
        expect.objectContaining({
          variantGroupId: "variant-b",
          status: "insufficient_variants",
          variantCount: 1
        })
      ])
    );
  });
});

function createEvaluatedExample(
  exampleId: string,
  variantGroupId: string,
  memoryScore: number,
  contextScore: number
) {
  return evaluatedExampleSchema.parse({
    exampleId,
    variantGroupId,
    taskType: "risk",
    mode: "initial",
    accuracyScore: 0.9,
    accuracyBin: "0.90-1.00",
    memoryScore,
    memoryState: "correct_save_correct_needed_retrieval",
    memoryPassed: true,
    contextScore,
    contextPassed: true,
    retryAttribution: {
      systemPromptVagueness: 0,
      toolDefinitionAmbiguity: 0,
      missingContext: 0,
      other: 0
    },
    peerMetrics: {
      systemPromptTokens: 200,
      toolDefinitionTokens: 100,
      multimodalRawTokens: 120,
      multimodalCompressedTokens: 40,
      toolRetryCount: 0
    },
    participantContextScores: [
      {
        participantId: "supervisor",
        participantType: "supervisor",
        complete: true,
        score: contextScore
      }
    ]
  });
}

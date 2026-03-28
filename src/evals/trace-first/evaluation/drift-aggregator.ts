import { evaluatedExampleSchema, type DriftSummary, type EvaluatedExample } from "../contracts/evaluated-example-schema.js";

export class DriftAggregator {
  attach(examples: EvaluatedExample[]): EvaluatedExample[] {
    const byVariantGroup = new Map<string, EvaluatedExample[]>();

    for (const example of examples) {
      const group = byVariantGroup.get(example.variantGroupId) ?? [];
      group.push(example);
      byVariantGroup.set(example.variantGroupId, group);
    }

    return examples.map((example) =>
      evaluatedExampleSchema.parse({
        ...example,
        drift: createDriftSummary(example.variantGroupId, byVariantGroup.get(example.variantGroupId) ?? [])
      })
    );
  }

  summarize(examples: EvaluatedExample[]): DriftSummary[] {
    const byVariantGroup = new Map<string, EvaluatedExample[]>();

    for (const example of examples) {
      const group = byVariantGroup.get(example.variantGroupId) ?? [];
      group.push(example);
      byVariantGroup.set(example.variantGroupId, group);
    }

    return [...byVariantGroup.entries()].map(([variantGroupId, group]) =>
      createDriftSummary(variantGroupId, group)
    );
  }
}

function createDriftSummary(
  variantGroupId: string,
  group: EvaluatedExample[]
): DriftSummary {
  if (group.length < 2) {
    return {
      variantGroupId,
      variantCount: group.length,
      status: "insufficient_variants",
      memoryMean: null,
      memoryStdDev: null,
      memoryCoefficientOfVariation: null,
      contextMean: null,
      contextStdDev: null,
      contextCoefficientOfVariation: null
    };
  }

  const memoryScores = group.map((example) => example.memoryScore);
  const contextScores = group.map((example) => example.contextScore);
  const memoryMean = mean(memoryScores);
  const contextMean = mean(contextScores);
  const memoryStdDev = populationStdDev(memoryScores, memoryMean);
  const contextStdDev = populationStdDev(contextScores, contextMean);
  const memoryCoefficientOfVariation = memoryStdDev / Math.max(memoryMean, 0.05);
  const contextCoefficientOfVariation = contextStdDev / Math.max(contextMean, 0.05);

  return {
    variantGroupId,
    variantCount: group.length,
    status:
      memoryCoefficientOfVariation < 0.15 && contextCoefficientOfVariation < 0.15
        ? "passed"
        : "failed",
    memoryMean: round(memoryMean),
    memoryStdDev: round(memoryStdDev),
    memoryCoefficientOfVariation: round(memoryCoefficientOfVariation),
    contextMean: round(contextMean),
    contextStdDev: round(contextStdDev),
    contextCoefficientOfVariation: round(contextCoefficientOfVariation)
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStdDev(values: number[], average: number): number {
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

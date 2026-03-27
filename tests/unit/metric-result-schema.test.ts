import { describe, expect, it } from "vitest";

import { metricResultSchema } from "../../src/evals/contracts/metric-result-schema.js";

describe("metricResultSchema", () => {
  it("accepts a valid metric result", () => {
    const metricResult = metricResultSchema.parse({
      metricId: "feedback-integration-001",
      metricFamily: "feedback_integration",
      score: 0.92,
      passed: true,
      summary: "The rerun applied reviewer feedback correctly.",
      details: {
        changedFindings: 1
      },
      evidenceRefs: ["feedback-proof-of-address"]
    });

    expect(metricResult.passed).toBe(true);
  });

  it("rejects scores outside the normalized range", () => {
    const result = metricResultSchema.safeParse({
      metricId: "invalid-score",
      metricFamily: "domain_correctness",
      score: 1.5,
      passed: false,
      summary: "Invalid score"
    });

    expect(result.success).toBe(false);
  });
});

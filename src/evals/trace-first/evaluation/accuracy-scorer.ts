import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { analyzeOutcomeCoverage } from "./outcome-coverage.js";

export type AccuracyScoreResult = {
  score: number;
  bin: string;
};

export class AccuracyScorer {
  score(bundle: RunBundle): AccuracyScoreResult {
    const score = analyzeOutcomeCoverage(bundle).score;

    return {
      score,
      bin: accuracyBin(score)
    };
  }
}

function accuracyBin(score: number): string {
  if (score < 0.5) {
    return "<0.50";
  }

  if (score < 0.75) {
    return "0.50-0.74";
  }

  if (score < 0.9) {
    return "0.75-0.89";
  }

  return "0.90-1.00";
}

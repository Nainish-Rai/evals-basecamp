import type { RunBundle } from "../contracts/run-bundle-schema.js";

export type AccuracyScoreResult = {
  score: number;
  bin: string;
};

export class AccuracyScorer {
  score(bundle: RunBundle): AccuracyScoreResult {
    const findingCoverage = average(
      bundle.example.evaluationSpec.requiredFindings.map((finding) =>
        containsMeaningfulContent(bundle.finalResponse, finding) ? 1 : 0
      ),
      1
    );
    const evidenceCoverage = average(
      bundle.example.evaluationSpec.expectedEvidenceRefs.map((evidenceRef) =>
        bundle.outputArtifacts.includes(evidenceRef) ? 1 : 0
      ),
      1
    );
    const dispositionScore = bundle.example.evaluationSpec.expectedDisposition
      ? bundle.finalResponse.toLowerCase().includes(
          bundle.example.evaluationSpec.expectedDisposition.toLowerCase()
        )
        ? 1
        : 0
      : 1;
    const score = roundScore((findingCoverage + evidenceCoverage + dispositionScore) / 3);

    return {
      score,
      bin: accuracyBin(score)
    };
  }
}

function containsMeaningfulContent(haystack: string, needle: string): boolean {
  const haystackLower = haystack.toLowerCase();
  const significantTerms = needle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4);

  if (significantTerms.length === 0) {
    return haystackLower.includes(needle.toLowerCase());
  }

  const matchedTerms = significantTerms.filter((term) => haystackLower.includes(term));

  return matchedTerms.length >= Math.ceil(significantTerms.length / 2);
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) {
    return fallback;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
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

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

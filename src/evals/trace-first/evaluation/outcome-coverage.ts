import type { RunBundle } from "../contracts/run-bundle-schema.js";

export type OutcomeCoverage = {
  score: number;
  findingCoverage: number;
  evidenceCoverage: number;
  dispositionScore: number;
  matchedFindings: string[];
  missingFindings: string[];
  matchedEvidenceRefs: string[];
  missingEvidenceRefs: string[];
  dispositionMatched: boolean;
};

export function analyzeOutcomeCoverage(bundle: RunBundle): OutcomeCoverage {
  const groundedEvidenceRefs = readGroundedEvidenceRefs(bundle.agentMetadata);
  const matchedFindings = bundle.example.evaluationSpec.requiredFindings.filter(
    (finding) => containsMeaningfulContent(bundle.finalResponse, finding)
  );
  const matchedEvidenceRefs =
    bundle.example.evaluationSpec.expectedEvidenceRefs.filter(
      (evidenceRef) =>
        bundle.outputArtifacts.includes(evidenceRef) ||
        groundedEvidenceRefs.includes(evidenceRef)
    );
  const expectedDisposition = bundle.example.evaluationSpec.expectedDisposition;
  const dispositionMatched = expectedDisposition
    ? containsMeaningfulContent(bundle.finalResponse, expectedDisposition)
    : true;
  const findingCoverage = average(
    matchedFindings.length,
    bundle.example.evaluationSpec.requiredFindings.length,
    1
  );
  const evidenceCoverage = average(
    matchedEvidenceRefs.length,
    bundle.example.evaluationSpec.expectedEvidenceRefs.length,
    1
  );
  const dispositionScore = dispositionMatched ? 1 : 0;

  return {
    score: roundScore(
      (findingCoverage + evidenceCoverage + dispositionScore) / 3
    ),
    findingCoverage,
    evidenceCoverage,
    dispositionScore,
    matchedFindings,
    missingFindings: bundle.example.evaluationSpec.requiredFindings.filter(
      (finding) => !matchedFindings.includes(finding)
    ),
    matchedEvidenceRefs,
    missingEvidenceRefs:
      bundle.example.evaluationSpec.expectedEvidenceRefs.filter(
        (evidenceRef) => !matchedEvidenceRefs.includes(evidenceRef)
      ),
    dispositionMatched
  };
}

function readGroundedEvidenceRefs(
  agentMetadata: RunBundle["agentMetadata"]
): string[] {
  const groundedEvidenceRefs = agentMetadata.groundedEvidenceRefs;

  if (!Array.isArray(groundedEvidenceRefs)) {
    return [];
  }

  return groundedEvidenceRefs.filter(
    (evidenceRef): evidenceRef is string =>
      typeof evidenceRef === "string" && evidenceRef.length > 0
  );
}

export function containsMeaningfulContent(
  haystack: string,
  needle: string
): boolean {
  const haystackLower = haystack.toLowerCase();
  const significantTerms = needle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4);

  if (significantTerms.length === 0) {
    return haystackLower.includes(needle.toLowerCase());
  }

  const matchedTerms = significantTerms.filter((term) =>
    haystackLower.includes(term)
  );

  return matchedTerms.length >= Math.ceil(significantTerms.length / 2);
}

function average(
  matchedCount: number,
  totalCount: number,
  fallback: number
): number {
  if (totalCount === 0) {
    return fallback;
  }

  return matchedCount / totalCount;
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

import { metricResultSchema } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { analyzeOutcomeCoverage } from "./outcome-coverage.js";

export class DomainCorrectnessScorer {
  score(bundle: RunBundle) {
    const coverage = analyzeOutcomeCoverage(bundle);
    const passThreshold = bundle.evaluationContext.minimumCorrectnessThreshold;

    return metricResultSchema.parse({
      metricId: `domain-correctness:${bundle.bundleId}`,
      metricFamily: "domain_correctness",
      score: coverage.score,
      passed: coverage.score >= passThreshold,
      summary: buildSummary(bundle, coverage),
      details: {
        minimumCorrectnessThreshold: passThreshold,
        correctnessExpectation: bundle.evaluationContext.correctnessExpectation ?? null,
        findingCoverage: coverage.findingCoverage,
        evidenceCoverage: coverage.evidenceCoverage,
        dispositionScore: coverage.dispositionScore,
        matchedFindings: coverage.matchedFindings,
        missingFindings: coverage.missingFindings,
        matchedEvidenceRefs: coverage.matchedEvidenceRefs,
        missingEvidenceRefs: coverage.missingEvidenceRefs,
        expectedDisposition: bundle.evaluationContext.expectedDisposition ?? null,
        dispositionMatched: coverage.dispositionMatched
      },
      evidenceRefs: bundle.evaluationContext.expectedEvidenceRefs
    });
  }
}

function buildSummary(
  bundle: RunBundle,
  coverage: ReturnType<typeof analyzeOutcomeCoverage>
): string {
  const missingFindingCount = coverage.missingFindings.length;
  const missingEvidenceCount = coverage.missingEvidenceRefs.length;
  const dispositionStatus = coverage.dispositionMatched ? "matched" : "missed";
  const expectation = bundle.evaluationContext.correctnessExpectation;

  if (expectation) {
    return `${expectation} Findings missed: ${missingFindingCount}. Evidence missed: ${missingEvidenceCount}. Disposition ${dispositionStatus}.`;
  }

  return `Findings missed: ${missingFindingCount}. Evidence missed: ${missingEvidenceCount}. Disposition ${dispositionStatus}.`;
}

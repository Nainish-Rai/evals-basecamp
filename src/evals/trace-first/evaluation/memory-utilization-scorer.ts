import { metricResultSchema, type MetricResult } from "../../contracts/metric-result-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import type { EvaluationJudge, MemoryJudgeOutput } from "./evaluation-judge.js";
import { collectMemoryEvidence } from "./memory-evidence.js";

type MemoryScoreComponents = {
  stateScore: number;
  writePrecision: number;
  writeRecall: number;
  readPrecision: number;
  readRecall: number;
  abstentionPrecision: number;
  abstentionRecall: number;
  impactScore: number;
  penaltyScore: number;
};

export type MemoryUtilizationDetails = MemoryScoreComponents & {
  counts: {
    observedCandidates: number;
    writes: number;
    skippedWrites: number;
    reads: number;
    usedReads: number;
    checkpointCount: number;
  };
  penalties: {
    irrelevantRetrieval: number;
    missedNeededRetrieval: number;
    missedNeededWrite: number;
    wastefulSave: number;
    harmfulMemoryActivation: number;
  };
  evidence: {
    usedWriteCandidateIds: string[];
    usedReadCandidateIds: string[];
    skippedWriteCandidateIds: string[];
    traceMemoryEventCounts: Record<string, number>;
  };
};

export type MemoryUtilizationResult = {
  score: number;
  state: MemoryJudgeOutput["state"];
  passed: boolean;
  rationale: string;
  details: MemoryUtilizationDetails;
  metricResult: MetricResult;
};

const MEMORY_STATE_SCORES: Record<MemoryJudgeOutput["state"], number> = {
  correct_save_correct_needed_retrieval: 1,
  correct_save_correct_abstention_from_retrieval: 0.94,
  correct_abstention_from_saving: 0.9,
  correct_save_irrelevant_retrieval: 0.68,
  missed_save_no_current_harm_yet: 0.55,
  correct_save_failed_needed_retrieval: 0.42,
  wasteful_save_not_used: 0.34,
  missed_save_later_needed: 0.22,
  wasteful_save_wrongly_used: 0
};

export class MemoryUtilizationScorer {
  constructor(private readonly judge: EvaluationJudge) {}

  async score(bundle: RunBundle): Promise<MemoryUtilizationResult> {
    const judgment = await this.judge.judgeMemory(bundle);
    const evidence = collectMemoryEvidence(bundle);
    const details = buildMemoryDetails(bundle, judgment.state, evidence);
    const score = roundScore(
      details.stateScore * 0.5 + details.penaltyScore * 0.1 + detailsSignal(details) * 0.4
    );
    const passed = Math.max(score, details.stateScore) >= 0.75;

    return {
      score,
      state: judgment.state,
      passed,
      rationale: buildRationale(judgment.rationale, details),
      details,
      metricResult: metricResultSchema.parse({
        metricId: `memory-utilization:${bundle.bundleId}`,
        metricFamily: "memory_utilization",
        score,
        passed,
        summary: buildSummary(judgment.state, score, details),
        details,
        evidenceRefs: buildEvidenceRefs(evidence)
      })
    };
  }
}

function buildMemoryDetails(
  bundle: RunBundle,
  state: MemoryJudgeOutput["state"],
  evidence: ReturnType<typeof collectMemoryEvidence>
): MemoryUtilizationDetails {
  const usedReadCandidateIds = uniqueCandidateIds(
    evidence.reads.filter((read) => read.usedInDecision).map((read) => read.candidateId)
  );
  const usedWriteCandidateIds = uniqueCandidateIds(
    evidence.writes
      .filter((write) => usedReadCandidateIds.includes(write.candidateId ?? ""))
      .map((write) => write.candidateId)
  );
  const skippedWriteCandidateIds = uniqueCandidateIds(
    evidence.skippedWrites.map((write) => write.candidateId)
  );
  const checkpointCount = evidence.checkpointIds.length;
  const totalDecisionCount = evidence.writes.length + evidence.skippedWrites.length;
  const writePrecision = scoreRatio(usedWriteCandidateIds.length, evidence.writes.length);
  const writeRecall = scoreRatio(usedWriteCandidateIds.length, checkpointCount);
  const readPrecision = scoreRatio(
    usedReadCandidateIds.length,
    evidence.reads.length
  );
  const readRecall = scoreRatio(usedReadCandidateIds.length, checkpointCount);
  const abstentionPrecision = scoreRatio(
    evidence.skippedWrites.length,
    totalDecisionCount
  );
  const abstentionRecall = scoreRatio(evidence.skippedWrites.length, checkpointCount);
  const impactScore = computeImpactScore(bundle, evidence);
  const penalties = {
    irrelevantRetrieval: penaltyRatio(
      evidence.reads.filter((read) => !read.usedInDecision).length,
      evidence.reads.length
    ),
    missedNeededRetrieval: penaltyRatio(
      Math.max(checkpointCount - usedReadCandidateIds.length, 0),
      checkpointCount
    ),
    missedNeededWrite: penaltyRatio(
      Math.max(checkpointCount - usedWriteCandidateIds.length, 0),
      checkpointCount
    ),
    wastefulSave: penaltyRatio(
      Math.max(evidence.writes.length - usedWriteCandidateIds.length, 0),
      evidence.writes.length
    ),
    harmfulMemoryActivation: penaltyRatio(
      evidence.reads.filter(
        (read) => read.usedInDecision && read.impact === "negative"
      ).length,
      usedReadCandidateIds.length
    )
  };

  return {
    stateScore: MEMORY_STATE_SCORES[state],
    writePrecision,
    writeRecall,
    readPrecision,
    readRecall,
    abstentionPrecision,
    abstentionRecall,
    impactScore,
    penaltyScore: roundScore(
      1 -
        average([
          penalties.irrelevantRetrieval,
          penalties.missedNeededRetrieval,
          penalties.missedNeededWrite,
          penalties.wastefulSave,
          penalties.harmfulMemoryActivation
        ])
    ),
    counts: {
      observedCandidates: evidence.observedCandidates.length,
      writes: evidence.writes.length,
      skippedWrites: evidence.skippedWrites.length,
      reads: evidence.reads.length,
      usedReads: usedReadCandidateIds.length,
      checkpointCount
    },
    penalties: {
      irrelevantRetrieval: roundScore(penalties.irrelevantRetrieval),
      missedNeededRetrieval: roundScore(penalties.missedNeededRetrieval),
      missedNeededWrite: roundScore(penalties.missedNeededWrite),
      wastefulSave: roundScore(penalties.wastefulSave),
      harmfulMemoryActivation: roundScore(penalties.harmfulMemoryActivation)
    },
    evidence: {
      usedWriteCandidateIds,
      usedReadCandidateIds,
      skippedWriteCandidateIds,
      traceMemoryEventCounts: evidence.traceEventCounts
    }
  };
}

function detailsSignal(details: MemoryUtilizationDetails): number {
  return average([
    details.writePrecision,
    details.writeRecall,
    details.readPrecision,
    details.readRecall,
    details.abstentionPrecision,
    details.abstentionRecall,
    details.impactScore,
    details.penaltyScore
  ]);
}

function computeImpactScore(
  bundle: RunBundle,
  evidence: ReturnType<typeof collectMemoryEvidence>
): number {
  const usedReadImpacts = evidence.reads
    .filter((read) => read.usedInDecision)
    .map((read) => impactToScore(read.impact));

  if (usedReadImpacts.length > 0) {
    return roundScore(average(usedReadImpacts));
  }

  if (evidence.reads.length === 0 && evidence.writes.length === 0) {
    return 1;
  }

  return roundScore(
    bundle.example.evaluationSpec.memoryCheckpoints.length === 0 ? 1 : 0.5
  );
}

function buildSummary(
  state: MemoryJudgeOutput["state"],
  score: number,
  details: MemoryUtilizationDetails
): string {
  return [
    `State ${state}.`,
    `Score ${score}.`,
    `Write precision ${details.writePrecision}, read precision ${details.readPrecision}, abstention precision ${details.abstentionPrecision}.`
  ].join(" ");
}

function buildRationale(
  judgmentRationale: string,
  details: MemoryUtilizationDetails
): string {
  return [
    judgmentRationale,
    `Observed ${details.counts.observedCandidates} candidates.`,
    `Trace memory events: ${sumValues(details.evidence.traceMemoryEventCounts)}.`
  ].join(" ");
}

function buildEvidenceRefs(evidence: ReturnType<typeof collectMemoryEvidence>): string[] {
  return uniqueCandidateIds([
    ...evidence.checkpointIds,
    ...evidence.checkpointDescriptions,
    ...evidence.observedCandidates.map((candidate) => candidate.candidateId),
    ...evidence.writes.map((decision) => decision.candidateId),
    ...evidence.skippedWrites.map((decision) => decision.candidateId),
    ...evidence.reads.map((decision) => decision.candidateId)
  ]);
}

function scoreRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return numerator <= 0 ? 1 : 0;
  }

  return roundScore(Math.max(0, Math.min(1, numerator / denominator)));
}

function penaltyRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return roundScore(Math.max(0, Math.min(1, numerator / denominator)));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function uniqueCandidateIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function impactToScore(impact: string | undefined): number {
  switch (impact) {
    case "positive":
      return 1;
    case "neutral":
      return 0.7;
    case "negative":
      return 0.2;
    default:
      return 0.5;
  }
}

function sumValues(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

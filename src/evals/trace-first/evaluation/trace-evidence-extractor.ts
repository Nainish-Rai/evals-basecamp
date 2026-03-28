import type { RunBundle } from "../contracts/run-bundle-schema.js";
import {
  analyzeOutcomeCoverage,
  containsMeaningfulContent
} from "./outcome-coverage.js";

type UnknownRecord = Record<string, unknown>;

type MemoryEventKind =
  | "observed_candidate"
  | "saved"
  | "skipped_save"
  | "retrieved"
  | "skipped_retrieval"
  | "used_in_decision";

export type TraceMemoryEvidence = {
  observedCandidateIds: string[];
  savedCandidateIds: string[];
  skippedSaveCandidateIds: string[];
  retrievedCandidateIds: string[];
  skippedRetrievalCandidateIds: string[];
  usedCandidateIds: string[];
  sources: string[];
  scopes: string[];
  traceEventNames: string[];
  traceEventCount: number;
};

export type TraceOutcomeEvidence = {
  requiredFindings: string[];
  matchedRequiredFindings: string[];
  missingRequiredFindings: string[];
  requiredFindingRecall: number;
  expectedEvidenceRefs: string[];
  groundedEvidenceRefs: string[];
  outputEvidenceRefs: string[];
  matchedEvidenceRefs: string[];
  missingEvidenceRefs: string[];
  evidenceRecall: number;
};

export type TraceEscalationEvidence = {
  expectedDisposition: string | null;
  dispositionMatched: boolean;
  inferredDecision: "escalate" | "hold" | "unknown";
  decisionMentioned: boolean;
};

export type TraceEvidenceSnapshot = {
  bundleId: string;
  exampleId: string;
  variantGroupId: string;
  runId: string;
  mode: RunBundle["mode"];
  taskType: string;
  traceId: string | null;
  tracePresent: boolean;
  traceSpanCount: number;
  traceEventCount: number;
  memory: TraceMemoryEvidence;
  outcome: TraceOutcomeEvidence;
  escalation: TraceEscalationEvidence;
};

export type TraceEvidenceComparison = {
  currentRunId: string;
  baselineRunId: string;
  requiredFindingRecallDelta: number;
  evidenceRecallDelta: number;
  dispositionMatchDelta: number;
  savedCandidateDelta: number;
  retrievedCandidateDelta: number;
  usedCandidateDelta: number;
  skippedSaveDelta: number;
  skippedRetrievalDelta: number;
  decisionChanged: boolean;
  currentDecision: TraceEscalationEvidence["inferredDecision"];
  baselineDecision: TraceEscalationEvidence["inferredDecision"];
};

export function createTraceEvidenceSnapshot(
  bundle: RunBundle
): TraceEvidenceSnapshot {
  const coverage = analyzeOutcomeCoverage(bundle);
  const memory = collectMemoryEvidence(bundle);
  const escalation = collectEscalationEvidence(bundle, coverage.dispositionMatched);
  const trace = bundle.trace;

  return {
    bundleId: bundle.bundleId,
    exampleId: bundle.example.exampleId,
    variantGroupId: bundle.example.variantGroupId,
    runId: bundle.runId,
    mode: bundle.mode,
    taskType: bundle.example.taskType,
    traceId: trace?.traceId ?? bundle.traceId,
    tracePresent: trace !== null,
    traceSpanCount: trace?.spans.length ?? 0,
    traceEventCount: trace?.events.length ?? 0,
    memory,
    outcome: {
      requiredFindings: bundle.example.evaluationSpec.requiredFindings,
      matchedRequiredFindings: coverage.matchedFindings,
      missingRequiredFindings: coverage.missingFindings,
      requiredFindingRecall: coverage.findingCoverage,
      expectedEvidenceRefs: bundle.example.evaluationSpec.expectedEvidenceRefs,
      groundedEvidenceRefs: readGroundedEvidenceRefs(bundle),
      outputEvidenceRefs: bundle.outputArtifacts,
      matchedEvidenceRefs: coverage.matchedEvidenceRefs,
      missingEvidenceRefs: coverage.missingEvidenceRefs,
      evidenceRecall: coverage.evidenceCoverage
    },
    escalation
  };
}

export function compareTraceEvidence(
  current: RunBundle,
  baseline: RunBundle
): TraceEvidenceComparison {
  const currentSnapshot = createTraceEvidenceSnapshot(current);
  const baselineSnapshot = createTraceEvidenceSnapshot(baseline);

  return {
    currentRunId: currentSnapshot.runId,
    baselineRunId: baselineSnapshot.runId,
    requiredFindingRecallDelta: roundDelta(
      currentSnapshot.outcome.requiredFindingRecall -
        baselineSnapshot.outcome.requiredFindingRecall
    ),
    evidenceRecallDelta: roundDelta(
      currentSnapshot.outcome.evidenceRecall -
        baselineSnapshot.outcome.evidenceRecall
    ),
    dispositionMatchDelta: currentSnapshot.escalation.dispositionMatched
      ? baselineSnapshot.escalation.dispositionMatched
        ? 0
        : 1
      : baselineSnapshot.escalation.dispositionMatched
        ? -1
        : 0,
    savedCandidateDelta:
      currentSnapshot.memory.savedCandidateIds.length -
      baselineSnapshot.memory.savedCandidateIds.length,
    retrievedCandidateDelta:
      currentSnapshot.memory.retrievedCandidateIds.length -
      baselineSnapshot.memory.retrievedCandidateIds.length,
    usedCandidateDelta:
      currentSnapshot.memory.usedCandidateIds.length -
      baselineSnapshot.memory.usedCandidateIds.length,
    skippedSaveDelta:
      currentSnapshot.memory.skippedSaveCandidateIds.length -
      baselineSnapshot.memory.skippedSaveCandidateIds.length,
    skippedRetrievalDelta:
      currentSnapshot.memory.skippedRetrievalCandidateIds.length -
      baselineSnapshot.memory.skippedRetrievalCandidateIds.length,
    decisionChanged:
      currentSnapshot.escalation.inferredDecision !==
      baselineSnapshot.escalation.inferredDecision,
    currentDecision: currentSnapshot.escalation.inferredDecision,
    baselineDecision: baselineSnapshot.escalation.inferredDecision
  };
}

function collectMemoryEvidence(bundle: RunBundle): TraceMemoryEvidence {
  const metadata = readRecord(bundle.agentMetadata);
  const traceEvents = bundle.trace?.events ?? [];
  const traceMemoryEvents = traceEvents
    .map((event) => normalizeTraceMemoryEvent(event.name, readRecord(event.metadata)))
    .filter((event): event is NormalizedTraceMemoryEvent => event !== null);

  const observedCandidateIds = uniqueStrings([
    ...readCandidateIds(metadata.memoryCandidatesObserved),
    ...candidateIdsFromEvents(traceMemoryEvents, "observed_candidate")
  ]);
  const savedCandidateIds = uniqueStrings([
    ...readCandidateIds(metadata.memoryWrites),
    ...candidateIdsFromEvents(traceMemoryEvents, "saved")
  ]);
  const skippedSaveCandidateIds = uniqueStrings([
    ...readCandidateIds(metadata.memoryWritesSkipped),
    ...candidateIdsFromEvents(traceMemoryEvents, "skipped_save")
  ]);
  const retrievedCandidateIds = uniqueStrings([
    ...readCandidateIds(metadata.memoryReads),
    ...candidateIdsFromEvents(traceMemoryEvents, "retrieved")
  ]);
  const skippedRetrievalCandidateIds = uniqueStrings([
    ...candidateIdsFromEvents(traceMemoryEvents, "skipped_retrieval")
  ]);
  const usedCandidateIds = uniqueStrings([
    ...readCandidateIds(metadata.memoryReads, "usedInDecision"),
    ...candidateIdsFromEvents(traceMemoryEvents, "used_in_decision")
  ]);
  const sources = uniqueStrings([
    ...readDecisionFieldValues(metadata.memoryWrites, "source"),
    ...readDecisionFieldValues(metadata.memoryWritesSkipped, "source"),
    ...readDecisionFieldValues(metadata.memoryReads, "source")
  ]);
  const scopes = uniqueStrings([
    ...readDecisionFieldValues(metadata.memoryWrites, "scope"),
    ...readDecisionFieldValues(metadata.memoryWritesSkipped, "scope"),
    ...readDecisionFieldValues(metadata.memoryReads, "scope")
  ]);

  return {
    observedCandidateIds,
    savedCandidateIds,
    skippedSaveCandidateIds,
    retrievedCandidateIds,
    skippedRetrievalCandidateIds,
    usedCandidateIds,
    sources,
    scopes,
    traceEventNames: traceMemoryEvents.map((event) => event.eventName),
    traceEventCount: traceMemoryEvents.length
  };
}

function collectEscalationEvidence(
  bundle: RunBundle,
  dispositionMatched: boolean
): TraceEscalationEvidence {
  const expectedDisposition = bundle.example.evaluationSpec.expectedDisposition ?? null;
  const lowerResponse = bundle.finalResponse.toLowerCase();
  const decisionMentioned = expectedDisposition
    ? containsMeaningfulContent(bundle.finalResponse, expectedDisposition)
    : lowerResponse.includes("escalat") ||
      lowerResponse.includes("hold") ||
      lowerResponse.includes("defer") ||
      lowerResponse.includes("continue");

  return {
    expectedDisposition,
    dispositionMatched,
    inferredDecision: inferDecision(bundle.finalResponse),
    decisionMentioned
  };
}

function inferDecision(finalResponse: string): TraceEscalationEvidence["inferredDecision"] {
  const lowerResponse = finalResponse.toLowerCase();

  if (lowerResponse.includes("escalat")) {
    return "escalate";
  }

  if (
    lowerResponse.includes("hold") ||
    lowerResponse.includes("defer") ||
    lowerResponse.includes("continue") ||
    lowerResponse.includes("maintain")
  ) {
    return "hold";
  }

  return "unknown";
}

type NormalizedTraceMemoryEvent = {
  eventName: string;
  kind: MemoryEventKind;
  candidateId: string;
};

function normalizeTraceMemoryEvent(
  eventName: string,
  metadata: UnknownRecord
): NormalizedTraceMemoryEvent | null {
  const kind = normalizeMemoryEventKind(eventName, metadata.type);
  const candidateId = readString(metadata.candidateId) ?? readString(metadata.id);

  if (!kind || !candidateId) {
    return null;
  }

  return {
    eventName,
    kind,
    candidateId
  };
}

function normalizeMemoryEventKind(
  eventName: string,
  metadataType: unknown
): MemoryEventKind | null {
  const normalizedType = typeof metadataType === "string" ? metadataType : "";
  const suffix = eventName.startsWith("memory.")
    ? eventName.slice("memory.".length)
    : normalizedType;

  switch (suffix) {
    case "observed_candidate":
    case "saved":
    case "skipped_save":
    case "retrieved":
    case "skipped_retrieval":
    case "used_in_decision":
      return suffix;
    default:
      return null;
  }
}

function candidateIdsFromEvents(
  events: NormalizedTraceMemoryEvent[],
  kind: MemoryEventKind
): string[] {
  return events
    .filter((event) => event.kind === kind)
    .map((event) => event.candidateId);
}

function readCandidateIds(
  items: unknown,
  predicateField: string | null = null
): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const record = readRecord(item);
    const candidateId = readString(record.candidateId);

    if (!candidateId) {
      return [];
    }

    if (!predicateField) {
      return [candidateId];
    }

    return readBoolean(record[predicateField]) ? [candidateId] : [];
  });
}

function readDecisionFieldValues(items: unknown, fieldName: string): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const record = readRecord(item);
    const value = readString(record[fieldName]);

    return value ? [value] : [];
  });
}

function readGroundedEvidenceRefs(bundle: RunBundle): string[] {
  const metadata = readRecord(bundle.agentMetadata);

  return uniqueStrings([
    ...readStringArray(metadata.groundedEvidenceRefs),
    ...bundle.outputArtifacts
  ]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as UnknownRecord;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4));
}

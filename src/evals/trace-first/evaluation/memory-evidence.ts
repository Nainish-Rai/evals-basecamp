import type {
  RunBundle,
  TraceExportRecord
} from "../contracts/run-bundle-schema.js";

type MemoryCandidateRecord = {
  candidateId: string;
  summary: string;
};

type MemoryDecisionRecord = MemoryCandidateRecord & {
  source: string;
  scope: string;
  rationale: string;
};

type MemoryReadRecord = MemoryCandidateRecord & {
  source: string;
  scope: string;
  neededNow: boolean;
  usedInDecision: boolean;
  impact: string;
  rationale: string | undefined;
};

type TraceMemoryEventRecord = {
  type: string;
  candidateId: string;
  summary: string;
  source: string;
  scope: string;
  rationale: string;
};

export type MemoryEvidence = {
  observedCandidates: MemoryCandidateRecord[];
  writes: MemoryDecisionRecord[];
  skippedWrites: MemoryDecisionRecord[];
  reads: MemoryReadRecord[];
  checkpointIds: string[];
  checkpointDescriptions: string[];
  checkpointedOpportunityIds: string[];
  retrieveCheckpointOpportunityIds: string[];
  skipCheckpointOpportunityIds: string[];
  traceEventCounts: Record<string, number>;
  traceMemoryEvents: TraceMemoryEventRecord[];
};

export function collectMemoryEvidence(bundle: RunBundle): MemoryEvidence {
  const evaluationSpec = bundle.example.evaluationSpec;
  const traceMemoryEvents = extractTraceMemoryEvents(bundle.trace);
  const observedCandidateIds = uniqueStrings([
    ...readMetadataCandidateIds(readMetadataArray(bundle.agentMetadata, "memoryCandidatesObserved")),
    ...candidateIdsFromEvents(traceMemoryEvents, "observed_candidate")
  ]);
  const writeCandidateIds = uniqueStrings([
    ...readMetadataCandidateIds(readMetadataArray(bundle.agentMetadata, "memoryWrites")),
    ...candidateIdsFromEvents(traceMemoryEvents, "saved")
  ]);
  const skippedWriteCandidateIds = uniqueStrings([
    ...readMetadataCandidateIds(readMetadataArray(bundle.agentMetadata, "memoryWritesSkipped")),
    ...candidateIdsFromEvents(traceMemoryEvents, "skipped_save")
  ]);
  const readCandidateIds = uniqueStrings([
    ...readMetadataCandidateIds(readMetadataArray(bundle.agentMetadata, "memoryReads")),
    ...candidateIdsFromEvents(traceMemoryEvents, "retrieved")
  ]);
  const usedReadCandidateIds = uniqueStrings(
    readMetadataArray(bundle.agentMetadata, "memoryReads")
      .filter((read) => read.usedInDecision === true)
      .map((read) => read.candidateId as string | undefined)
  );
  const skippedReadCandidateIds = uniqueStrings(
    readMetadataArray(bundle.agentMetadata, "memoryReads")
      .filter((read) => read.usedInDecision === false)
      .map((read) => read.candidateId as string | undefined)
  );

  return {
    observedCandidates: normalizeCandidateRecords(
      readMetadataArray(bundle.agentMetadata, "memoryCandidatesObserved")
    ),
    writes: normalizeDecisionRecords(
      readMetadataArray(bundle.agentMetadata, "memoryWrites")
    ),
    skippedWrites: normalizeDecisionRecords(
      readMetadataArray(bundle.agentMetadata, "memoryWritesSkipped")
    ),
    reads: normalizeReadRecords(readMetadataArray(bundle.agentMetadata, "memoryReads")),
    checkpointIds: evaluationSpec.memoryCheckpoints.map(
      (checkpoint) => checkpoint.checkpointId
    ),
    checkpointDescriptions: evaluationSpec.memoryCheckpoints.map(
      (checkpoint) => checkpoint.description
    ),
    checkpointedOpportunityIds: uniqueStrings([
      ...observedCandidateIds,
      ...writeCandidateIds,
      ...skippedWriteCandidateIds,
      ...readCandidateIds
    ]),
    retrieveCheckpointOpportunityIds: uniqueStrings([
      ...usedReadCandidateIds,
      ...candidateIdsFromEvents(traceMemoryEvents, "used_in_decision")
    ]),
    skipCheckpointOpportunityIds: uniqueStrings([
      ...skippedWriteCandidateIds,
      ...skippedReadCandidateIds
    ]),
    traceEventCounts: countBy(
      traceMemoryEvents.map((event) => event.type ?? "unknown")
    ),
    traceMemoryEvents
  };
}

function readMetadataArray(
  metadata: Record<string, unknown>,
  key: string
): Record<string, unknown>[] {
  const value = metadata[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === "object"
  );
}

function normalizeCandidateRecords(
  values: Record<string, unknown>[]
): MemoryCandidateRecord[] {
  return values.flatMap((value) => {
    const candidateId = readString(value.candidateId);
    const summary = readString(value.summary);

    if (!candidateId || !summary) {
      return [];
    }

    return [{ candidateId, summary }];
  });
}

function readMetadataCandidateIds(values: Record<string, unknown>[]): string[] {
  return uniqueStrings(
    values.map((value) => readString(value.candidateId)).filter(
      (candidateId): candidateId is string => Boolean(candidateId)
    )
  );
}

function normalizeDecisionRecords(
  values: Record<string, unknown>[]
): MemoryDecisionRecord[] {
  return values.flatMap((value) => {
    const candidateId = readString(value.candidateId);
    const summary = readString(value.summary);
    const source = readString(value.source);
    const scope = readString(value.scope);
    const rationale = readString(value.rationale);

    if (!candidateId || !summary || !source || !scope || !rationale) {
      return [];
    }

    return [{ candidateId, summary, source, scope, rationale }];
  });
}

function normalizeReadRecords(
  values: Record<string, unknown>[]
): MemoryReadRecord[] {
  return values.flatMap((value) => {
    const candidateId = readString(value.candidateId);
    const summary = readString(value.summary);
    const source = readString(value.source);
    const scope = readString(value.scope);
    const impact = readString(value.impact);
    const neededNow = readBoolean(value.neededNow);
    const usedInDecision = readBoolean(value.usedInDecision);

    if (
      !candidateId ||
      !summary ||
      !source ||
      !scope ||
      !impact ||
      neededNow === undefined ||
      usedInDecision === undefined
    ) {
      return [];
    }

    return [
      {
        candidateId,
        summary,
        source,
        scope,
        rationale: readString(value.rationale),
        neededNow,
        usedInDecision,
        impact
      }
    ];
  });
}

function extractTraceMemoryEvents(
  trace: TraceExportRecord | null
): TraceMemoryEventRecord[] {
  if (!trace) {
    return [];
  }

  return trace.events
    .filter((event) => event.name.startsWith("memory."))
    .map((event) => ({
      type: event.name.slice("memory.".length),
      candidateId: readString(event.metadata.candidateId),
      summary: readString(event.metadata.summary),
      source: readString(event.metadata.source),
      scope: readString(event.metadata.scope),
      rationale: readString(event.metadata.rationale)
    }))
    .filter(
      (event): event is TraceMemoryEventRecord =>
        event.candidateId !== undefined &&
        event.summary !== undefined &&
        event.source !== undefined &&
        event.scope !== undefined &&
        event.rationale !== undefined &&
        event.type !== undefined
    );
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function candidateIdsFromEvents(
  events: TraceMemoryEventRecord[],
  kind: string
): string[] {
  return uniqueStrings(
    events
      .filter((event) => event.type === kind)
      .map((event) => event.candidateId)
  );
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

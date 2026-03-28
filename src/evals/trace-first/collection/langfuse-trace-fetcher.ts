import { Buffer } from "node:buffer";

import { loadEnvironmentConfig } from "../../../infra/config/env.js";
import type { TraceExportRecord } from "../contracts/run-bundle-schema.js";

type LangfuseTraceFetcherOptions = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  fetchImplementation?: typeof fetch;
};

type LangfuseListTrace = {
  id: string;
  name?: string | null;
  sessionId?: string | null;
  timestamp?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type LangfuseTraceDetail = LangfuseListTrace & {
  metadata?: unknown;
  input?: unknown;
  output?: unknown;
  scores?: unknown[];
};

type LangfuseObservation = {
  id: string;
  parentObservationId?: string | null;
  traceId?: string | null;
  name?: string | null;
  type?: string | null;
  level?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: unknown;
  input?: unknown;
  output?: unknown;
  statusMessage?: string | null;
  scores?: unknown[];
};

export interface TraceFirstTraceFetcher {
  fetchTraceByRunId(runId: string): Promise<TraceExportRecord>;
}

export class LangfuseTraceFetcher implements TraceFirstTraceFetcher {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: LangfuseTraceFetcherOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  static fromEnvironment(): LangfuseTraceFetcher {
    const environmentConfig = loadEnvironmentConfig();

    if (!environmentConfig.LANGFUSE_PUBLIC_KEY || !environmentConfig.LANGFUSE_SECRET_KEY) {
      throw new Error(
        "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required to hydrate run bundles from Langfuse"
      );
    }

    return new LangfuseTraceFetcher({
      baseUrl: environmentConfig.LANGFUSE_BASE_URL,
      publicKey: environmentConfig.LANGFUSE_PUBLIC_KEY,
      secretKey: environmentConfig.LANGFUSE_SECRET_KEY
    });
  }

  async fetchTraceByRunId(runId: string): Promise<TraceExportRecord> {
    const traceSummary = await this.findTraceBySessionId(runId);
    const traceId = traceSummary.id;
    const [traceDetailBody, observations] = await Promise.all([
      this.fetchJson(`/api/public/traces/${traceId}`),
      this.fetchObservations(traceId)
    ]);
    const traceDetail = readTraceDetail(traceDetailBody, traceId);

    return normalizeTraceRecord({
      runId,
      trace: traceDetail,
      observations
    });
  }

  private async findTraceBySessionId(runId: string): Promise<LangfuseListTrace> {
    const responseBody = await this.fetchJson("/api/public/traces", {
      sessionId: runId,
      limit: "25",
      orderBy: "timestamp.DESC"
    });
    const traces = readItems<LangfuseListTrace>(responseBody)
      .map((trace) => normalizeListTrace(trace))
      .filter((trace): trace is LangfuseListTrace => trace !== null);
    const matchedTrace =
      traces.find((trace) => trace.sessionId === runId) ?? traces[0];

    if (!matchedTrace) {
      throw new Error(`No Langfuse trace found for runId "${runId}"`);
    }

    return matchedTrace;
  }

  private async fetchObservations(traceId: string): Promise<LangfuseObservation[]> {
    const observations: LangfuseObservation[] = [];
    const limit = 100;

    for (let page = 1; page <= 10; page += 1) {
      const responseBody = await this.fetchJson("/api/public/observations", {
        traceId,
        page: String(page),
        limit: String(limit)
      });
      const pageItems = readItems<LangfuseObservation>(responseBody)
        .map((observation) => normalizeObservation(observation))
        .filter((observation): observation is LangfuseObservation => observation !== null);

      observations.push(...pageItems);

      if (pageItems.length < limit) {
        break;
      }
    }

    return observations;
  }

  private async fetchJson(
    pathname: string,
    query: Record<string, string> = {}
  ): Promise<unknown> {
    const url = new URL(pathname, ensureTrailingSlash(this.options.baseUrl));

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.options.publicKey}:${this.options.secretKey}`
        ).toString("base64")}`
      }
    });

    if (!response.ok) {
      throw new Error(
        `Langfuse request failed with status ${response.status} for ${url.pathname}`
      );
    }

    return JSON.parse(await response.text()) as unknown;
  }
}

function normalizeTraceRecord(options: {
  runId: string;
  trace: LangfuseTraceDetail;
  observations: LangfuseObservation[];
}): TraceExportRecord {
  const spans = options.observations
    .filter((observation) => !isEventObservation(observation))
    .map((observation) => ({
      spanId: observation.id,
      parentSpanId: observation.parentObservationId ?? null,
      name: observation.name ?? "langfuse_observation",
      kind: normalizeObservationKind(observation),
      status: (
        observation.level?.toUpperCase() === "ERROR" ? "failed" : "completed"
      ) as "failed" | "completed",
      startedAt:
        observation.startTime ??
        observation.createdAt ??
        options.trace.timestamp ??
        new Date().toISOString(),
      endedAt:
        observation.endTime ??
        observation.updatedAt ??
        observation.startTime ??
        observation.createdAt ??
        options.trace.updatedAt ??
        options.trace.createdAt ??
        new Date().toISOString(),
      metadata: {
        ...(toRecord(observation.metadata) ?? {}),
        ...(observation.input === undefined ? {} : { input: observation.input }),
        ...(observation.output === undefined ? {} : { output: observation.output })
      },
      scores: normalizeScores(observation.scores),
      errorMessage:
        observation.level?.toUpperCase() === "ERROR"
          ? observation.statusMessage ?? "Langfuse observation failed"
          : null
    }));
  const events = options.observations
    .filter((observation) => isEventObservation(observation))
    .map((observation) => ({
      eventId: observation.id,
      parentSpanId: observation.parentObservationId ?? null,
      name: observation.name ?? "langfuse_event",
      recordedAt:
        observation.startTime ??
        observation.createdAt ??
        options.trace.timestamp ??
        new Date().toISOString(),
      metadata: {
        ...(toRecord(observation.metadata) ?? {}),
        ...(observation.input === undefined ? {} : { input: observation.input }),
        ...(observation.output === undefined ? {} : { output: observation.output })
      }
    }));
  const startedAt =
    options.trace.timestamp ??
    options.trace.createdAt ??
    spans[0]?.startedAt ??
    events[0]?.recordedAt ??
    null;
  const endedAt =
    options.trace.updatedAt ??
    spans.reduce<string | null>(
      (latest, span) => (latest && latest > span.endedAt ? latest : span.endedAt),
      null
    ) ??
    startedAt;

  return {
    traceId: options.trace.id,
    enabled: true,
    traceName: options.trace.name ?? null,
    status: spans.some((span) => span.status === "failed") ? "failed" : "completed",
    startedAt,
    endedAt,
    metadata: {
      runId: options.runId,
      sessionId: options.trace.sessionId ?? options.runId,
      ...(toRecord(options.trace.metadata) ?? {}),
      ...(options.trace.input === undefined ? {} : { input: options.trace.input }),
      ...(options.trace.output === undefined ? {} : { output: options.trace.output })
    },
    scores: normalizeScores(options.trace.scores),
    spans,
    events,
    vendorTraceIds: [options.trace.id]
  };
}

function readTraceDetail(responseBody: unknown, traceId: string): LangfuseTraceDetail {
  const directTrace = normalizeTraceDetail(responseBody);

  if (directTrace && directTrace.id === traceId) {
    return directTrace;
  }

  const nestedTrace = normalizeTraceDetail(
    responseBody && typeof responseBody === "object" && "data" in responseBody
      ? (responseBody as { data?: unknown }).data
      : null
  );

  if (nestedTrace && nestedTrace.id === traceId) {
    return nestedTrace;
  }

  throw new Error(`Langfuse trace detail response did not contain trace "${traceId}"`);
}

function readItems<T>(responseBody: unknown): T[] {
  if (Array.isArray(responseBody)) {
    return responseBody as T[];
  }

  if (!responseBody || typeof responseBody !== "object") {
    return [];
  }

  const record = responseBody as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    return record.data as T[];
  }

  if (record.data && typeof record.data === "object") {
    const nested = record.data as Record<string, unknown>;

    if (Array.isArray(nested.data)) {
      return nested.data as T[];
    }

    if (Array.isArray(nested.traces)) {
      return nested.traces as T[];
    }

    if (Array.isArray(nested.observations)) {
      return nested.observations as T[];
    }
  }

  if (Array.isArray(record.traces)) {
    return record.traces as T[];
  }

  if (Array.isArray(record.observations)) {
    return record.observations as T[];
  }

  return [];
}

function normalizeListTrace(value: unknown): LangfuseListTrace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readString(record.id);

  if (!id) {
    return null;
  }

  return {
    id,
    name: readNullableString(record.name),
    sessionId: readNullableString(record.sessionId ?? record.session_id),
    timestamp: readNullableString(record.timestamp),
    createdAt: readNullableString(record.createdAt ?? record.created_at),
    updatedAt: readNullableString(record.updatedAt ?? record.updated_at)
  };
}

function normalizeTraceDetail(value: unknown): LangfuseTraceDetail | null {
  const trace = normalizeListTrace(value);

  if (!trace || !value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    ...trace,
    metadata: record.metadata,
    input: record.input,
    output: record.output,
    scores: Array.isArray(record.scores) ? record.scores : []
  };
}

function normalizeObservation(value: unknown): LangfuseObservation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readString(record.id);

  if (!id) {
    return null;
  }

  return {
    id,
    parentObservationId: readNullableString(
      record.parentObservationId ?? record.parent_observation_id
    ),
    traceId: readNullableString(record.traceId ?? record.trace_id),
    name: readNullableString(record.name),
    type: readNullableString(record.type),
    level: readNullableString(record.level),
    startTime: readNullableString(record.startTime ?? record.start_time),
    endTime: readNullableString(record.endTime ?? record.end_time),
    createdAt: readNullableString(record.createdAt ?? record.created_at),
    updatedAt: readNullableString(record.updatedAt ?? record.updated_at),
    metadata: record.metadata,
    input: record.input,
    output: record.output,
    statusMessage: readNullableString(record.statusMessage ?? record.status_message),
    scores: Array.isArray(record.scores) ? record.scores : []
  };
}

function normalizeObservationKind(observation: LangfuseObservation): string {
  const metadata = toRecord(observation.metadata);
  const explicitKind = readString(
    metadata?.kind ?? metadata?.traceKind ?? metadata?.participantKind
  );

  if (explicitKind) {
    return explicitKind;
  }

  const type = observation.type?.toLowerCase();

  if (type === "tool") {
    return "tool";
  }

  if (type === "retriever") {
    return "retrieval";
  }

  if (
    type === "agent" &&
    (readString(metadata?.subagentId) ||
      readString(metadata?.participantType) === "subagent" ||
      observation.name?.toLowerCase().includes("subagent"))
  ) {
    return "subagent_call";
  }

  if (type === "agent" || type === "chain" || type === "generation") {
    return "graph_node";
  }

  return "runner";
}

function isEventObservation(observation: LangfuseObservation): boolean {
  return observation.type?.toLowerCase() === "event";
}

function normalizeScores(scores: unknown[] | undefined) {
  return (scores ?? []).flatMap((score) => {
    if (!score || typeof score !== "object") {
      return [];
    }

    const record = score as Record<string, unknown>;
    const name = readString(record.name);
    const value = record.value;

    if (!name || (typeof value !== "number" && typeof value !== "string")) {
      return [];
    }

    const comment = readString(record.comment);

    return [
      {
        name,
        value,
        ...(comment ? { comment } : {})
      }
    ];
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

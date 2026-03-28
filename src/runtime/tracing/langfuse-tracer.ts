type TraceStatus = "running" | "completed" | "failed";

export type TraceSpanKind =
  | "runner"
  | "graph_node"
  | "tool"
  | "retrieval"
  | "workspace_write"
  | "subagent_call"
  | "memory_event"
  | "agent_http_call";

export type NumericTraceScore = {
  name: string;
  value: number;
  comment?: string;
};

export type CategoricalTraceScore = {
  name: string;
  value: string;
  comment?: string;
};

export type TraceScore = NumericTraceScore | CategoricalTraceScore;

export type MemoryEventType =
  | "observed_candidate"
  | "saved"
  | "skipped_save"
  | "retrieved"
  | "skipped_retrieval"
  | "used_in_decision";

export type MemoryDecisionEvent = {
  type: MemoryEventType;
  candidateId: string;
  summary: string;
  source?: string;
  scope?: string;
  rationale?: string;
};

export type TraceSpanRecord = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: TraceSpanKind;
  status: Exclude<TraceStatus, "running">;
  startedAt: string;
  endedAt: string;
  metadata: Record<string, unknown>;
  scores: TraceScore[];
  errorMessage: string | null;
};

export type TraceEventRecord = {
  eventId: string;
  parentSpanId: string | null;
  name: string;
  recordedAt: string;
  metadata: Record<string, unknown>;
};

export type TraceExport = {
  traceId: string | null;
  enabled: boolean;
  traceName: string | null;
  status: Exclude<TraceStatus, "running">;
  startedAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  scores: TraceScore[];
  spans: TraceSpanRecord[];
  events: TraceEventRecord[];
  vendorTraceIds: string[];
};

export type LangfuseTraceContext = {
  traceId: string | null;
  enabled: boolean;
  traceName: string | null;
  status: Exclude<TraceStatus, "running">;
  startedAt: string | null;
  endedAt: string | null;
  spanCount: number;
  scoreCount: number;
  eventCount: number;
  vendorTraceIds: string[];
};

export type TraceSpanOptions = {
  name: string;
  kind: TraceSpanKind;
  metadata?: Record<string, unknown>;
};

export type StartTraceOptions = {
  name: string;
  metadata?: Record<string, unknown>;
};

export type BenchmarkTrace = {
  runInSpan<T>(options: TraceSpanOptions, operation: () => Promise<T>): Promise<T>;
  recordScore(score: TraceScore): void;
  recordMemoryDecision(event: MemoryDecisionEvent): void;
  recordEvent(name: string, metadata?: Record<string, unknown>): void;
  attachVendorTraceId(traceId: string): void;
  annotate(metadata: Record<string, unknown>): void;
  snapshot(): LangfuseTraceContext;
  finish(): LangfuseTraceContext;
  export(): TraceExport | null;
};

export type LangfuseTracerOptions = {
  enabled?: boolean;
};

type MutableTraceState = {
  status: TraceStatus;
  metadata: Record<string, unknown>;
  scores: TraceScore[];
  spans: TraceSpanRecord[];
  events: TraceEventRecord[];
  vendorTraceIds: Set<string>;
  startedAt: string;
  endedAt: string | null;
};

class DisabledBenchmarkTrace implements BenchmarkTrace {
  private readonly context: LangfuseTraceContext = {
    traceId: null,
    enabled: false,
    traceName: null,
    status: "completed",
    startedAt: null,
    endedAt: null,
    spanCount: 0,
    scoreCount: 0,
    eventCount: 0,
    vendorTraceIds: []
  };

  async runInSpan<T>(_options: TraceSpanOptions, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  recordScore(score: TraceScore): void {
    void score;
  }

  recordMemoryDecision(event: MemoryDecisionEvent): void {
    void event;
  }

  recordEvent(name: string, metadata?: Record<string, unknown>): void {
    void name;
    void metadata;
  }

  attachVendorTraceId(traceId: string): void {
    void traceId;
  }

  annotate(metadata: Record<string, unknown>): void {
    void metadata;
  }

  snapshot(): LangfuseTraceContext {
    return this.context;
  }

  finish(): LangfuseTraceContext {
    return this.context;
  }

  export(): TraceExport | null {
    return null;
  }
}

class InMemoryBenchmarkTrace implements BenchmarkTrace {
  private readonly activeSpanIds: string[] = [];

  constructor(
    private readonly traceId: string,
    private readonly traceName: string,
    private readonly state: MutableTraceState
  ) {}

  async runInSpan<T>(options: TraceSpanOptions, operation: () => Promise<T>): Promise<T> {
    const spanId = `${this.traceId}-span-${this.state.spans.length + 1}`;
    const startedAt = new Date().toISOString();
    const spanRecord: TraceSpanRecord = {
      spanId,
      parentSpanId: this.currentSpanId(),
      name: options.name,
      kind: options.kind,
      status: "completed",
      startedAt,
      endedAt: startedAt,
      metadata: { ...(options.metadata ?? {}) },
      scores: [],
      errorMessage: null
    };

    this.activeSpanIds.push(spanId);
    this.state.spans.push(spanRecord);

    try {
      return await operation();
    } catch (error) {
      spanRecord.status = "failed";
      spanRecord.errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      spanRecord.endedAt = new Date().toISOString();
      this.activeSpanIds.pop();
    }
  }

  recordScore(score: TraceScore): void {
    const currentSpan = this.findCurrentSpan();

    if (currentSpan) {
      currentSpan.scores.push(score);
      return;
    }

    this.state.scores.push(score);
  }

  recordMemoryDecision(event: MemoryDecisionEvent): void {
    this.recordEvent(`memory.${event.type}`, event);
  }

  recordEvent(name: string, metadata: Record<string, unknown> = {}): void {
    this.state.events.push({
      eventId: `${this.traceId}-event-${this.state.events.length + 1}`,
      parentSpanId: this.currentSpanId(),
      name,
      recordedAt: new Date().toISOString(),
      metadata
    });
  }

  attachVendorTraceId(traceId: string): void {
    this.state.vendorTraceIds.add(traceId);
  }

  annotate(metadata: Record<string, unknown>): void {
    this.state.metadata = {
      ...this.state.metadata,
      ...metadata
    };
  }

  snapshot(): LangfuseTraceContext {
    return {
      traceId: this.traceId,
      enabled: true,
      traceName: this.traceName,
      status: "completed",
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      spanCount: this.state.spans.length,
      scoreCount:
        this.state.scores.length +
        this.state.spans.reduce((count, span) => count + span.scores.length, 0),
      eventCount: this.state.events.length,
      vendorTraceIds: [...this.state.vendorTraceIds]
    };
  }

  finish(): LangfuseTraceContext {
    this.state.status = this.state.spans.some((span) => span.status === "failed")
      ? "failed"
      : "completed";
    this.state.endedAt ??= new Date().toISOString();

    return {
      traceId: this.traceId,
      enabled: true,
      traceName: this.traceName,
      status: this.state.status,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      spanCount: this.state.spans.length,
      scoreCount:
        this.state.scores.length +
        this.state.spans.reduce((count, span) => count + span.scores.length, 0),
      eventCount: this.state.events.length,
      vendorTraceIds: [...this.state.vendorTraceIds]
    };
  }

  export(): TraceExport {
    this.state.endedAt ??= new Date().toISOString();

    return {
      traceId: this.traceId,
      enabled: true,
      traceName: this.traceName,
      status: this.state.status === "running" ? "completed" : this.state.status,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      metadata: { ...this.state.metadata },
      scores: [...this.state.scores],
      spans: this.state.spans.map((span) => ({
        ...span,
        metadata: { ...span.metadata },
        scores: [...span.scores]
      })),
      events: this.state.events.map((event) => ({
        ...event,
        metadata: { ...event.metadata }
      })),
      vendorTraceIds: [...this.state.vendorTraceIds]
    };
  }

  private currentSpanId(): string | null {
    return this.activeSpanIds.at(-1) ?? null;
  }

  private findCurrentSpan(): TraceSpanRecord | undefined {
    const currentSpanId = this.currentSpanId();

    if (!currentSpanId) {
      return undefined;
    }

    return this.state.spans.find((span) => span.spanId === currentSpanId);
  }
}

export class LangfuseTracer {
  private readonly enabled: boolean;

  constructor(options: LangfuseTracerOptions = {}) {
    this.enabled = options.enabled ?? false;
  }

  startTrace(options: StartTraceOptions): BenchmarkTrace {
    if (!this.enabled) {
      return new DisabledBenchmarkTrace();
    }

    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return new InMemoryBenchmarkTrace(traceId, options.name, {
      status: "running",
      metadata: { ...(options.metadata ?? {}) },
      scores: [],
      spans: [],
      events: [],
      vendorTraceIds: new Set<string>(),
      startedAt: new Date().toISOString(),
      endedAt: null
    });
  }
}

import type { EvalTrajectoryEvaluationSpec } from "../contracts/eval-example-schema.js";
import type { RunBundle, TraceExportRecord } from "../contracts/run-bundle-schema.js";

type UnknownRecord = Record<string, unknown>;

export type TrajectoryObservedEvidence = {
  graphPath: string[];
  traceSpanNames: string[];
  toolNames: string[];
  delegationIds: string[];
  delegationTaskSummaries: string[];
  traceSpanCount: number;
};

export type TrajectoryEvidenceSnapshot = {
  bundleId: string;
  runId: string;
  agentLabel: string;
  mode: RunBundle["mode"];
  expectation: EvalTrajectoryEvaluationSpec;
  observed: TrajectoryObservedEvidence;
};

export function createTrajectoryEvidenceSnapshot(
  bundle: RunBundle
): TrajectoryEvidenceSnapshot {
  return {
    bundleId: bundle.bundleId,
    runId: bundle.runId,
    agentLabel: bundle.agentLabel,
    mode: bundle.mode,
    expectation: resolveTrajectoryExpectation(bundle),
    observed: collectObservedTrajectory(bundle)
  };
}

function resolveTrajectoryExpectation(
  bundle: RunBundle
): EvalTrajectoryEvaluationSpec {
  const trajectory = bundle.example.evaluationSpec.trajectory;

  return {
    requiredSteps: trajectory.requiredSteps,
    criticalTools: trajectory.criticalTools,
    criticalDelegations: trajectory.criticalDelegations,
    allowedStepFlexibility: trajectory.allowedStepFlexibility,
    allowAdditionalSteps: trajectory.allowAdditionalSteps
  };
}

function collectObservedTrajectory(bundle: RunBundle): TrajectoryObservedEvidence {
  const metadata = readRecord(bundle.agentMetadata);
  const trace = bundle.trace;
  const graphPath = readStringArray(metadata.graphPath);
  const traceSpanNames = readTraceSpanNames(trace);
  const toolNames = uniqueStrings([
    ...readToolNames(metadata.toolCalls),
    ...readTraceToolNames(trace)
  ]);
  const delegationIds = uniqueStrings([
    ...readDelegationIds(metadata.subagentEvents),
    ...readTraceDelegationIds(trace)
  ]);
  const delegationTaskSummaries = uniqueStrings([
    ...readDelegationSummaries(metadata.subagentEvents),
    ...readTraceDelegationSummaries(trace)
  ]);

  return {
    graphPath: graphPath.length > 0 ? graphPath : traceSpanNames,
    traceSpanNames,
    toolNames,
    delegationIds,
    delegationTaskSummaries,
    traceSpanCount: trace?.spans.length ?? 0
  };
}

function readTraceSpanNames(trace: TraceExportRecord | null): string[] {
  if (!trace) {
    return [];
  }

  return trace.spans
    .map((span) => span.name)
    .filter((name) => name.length > 0);
}

function readTraceToolNames(trace: TraceExportRecord | null): string[] {
  if (!trace) {
    return [];
  }

  return trace.spans
    .filter((span) => span.kind === "tool")
    .map((span) => span.metadata.toolName)
    .filter((toolName): toolName is string => typeof toolName === "string" && toolName.length > 0);
}

function readTraceDelegationIds(trace: TraceExportRecord | null): string[] {
  if (!trace) {
    return [];
  }

  return trace.spans
    .filter((span) => span.kind === "subagent_call")
    .map((span) => readString(span.metadata.subagentId) ?? span.name)
    .filter((value): value is string => Boolean(value));
}

function readTraceDelegationSummaries(trace: TraceExportRecord | null): string[] {
  if (!trace) {
    return [];
  }

  return trace.spans
    .filter((span) => span.kind === "subagent_call")
    .map((span) => readString(span.metadata.taskSummary))
    .filter((value): value is string => Boolean(value));
}

function readToolNames(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const record = readRecord(item);
    const toolName = readString(record.toolName);

    return toolName ? [toolName] : [];
  });
}

function readDelegationIds(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const record = readRecord(item);
    const subagentId = readString(record.subagentId) ?? readString(record.taskSummary);

    return subagentId ? [subagentId] : [];
  });
}

function readDelegationSummaries(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const record = readRecord(item);
    const summary = readString(record.taskSummary);

    return summary ? [summary] : [];
  });
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

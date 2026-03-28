import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { RunBundle, TraceExportRecord } from "../contracts/run-bundle-schema.js";
import type { EvaluationJudge, RetryAttributionLabel } from "./evaluation-judge.js";

type AgentMetadataContextMetrics = {
  promptTokens?: number;
  retrievedContextTokens?: number;
  unusedContextTokens?: number;
  subagentCommunicationTokens?: number;
};

type AgentMetadataToolCall = {
  toolName?: string;
  status?: string;
  inputSummary?: string;
  outputSummary?: string;
  inputArtifactRefs?: string[];
};

type AgentMetadataMultimodalEvent = {
  sourceTokenCount?: number;
  normalizedTokenCount?: number;
};

type AgentMetadataSubagentEvent = {
  subagentId?: string;
  taskSummary?: string;
  status?: string;
};

export type ContextEfficiencyResult = {
  score: number;
  passed: boolean;
  retryAttribution: EvaluatedExample["retryAttribution"];
  participantContextScores: EvaluatedExample["participantContextScores"];
  peerMetrics: EvaluatedExample["peerMetrics"];
};

type Participant = {
  participantId: string;
  participantType: "supervisor" | "subagent";
  complete: boolean;
  systemPromptTokens: number;
  toolDefinitionTokens: number;
  totalInputTokens: number;
  toolCallCount: number;
  toolRetryCount: number;
  multimodalRawTokens: number;
  multimodalCompressedTokens: number;
  duplicateReadCount: number;
  totalReadCount: number;
  unusedContextTokens: number | null;
  retrievedContextTokens: number | null;
  redundantHandoffTokens: number;
  handoffPromptTokens: number;
  failedToolCalls: AgentMetadataToolCall[];
};

const CONTEXT_WEIGHTS = {
  staticOverhead: 0.3,
  toolUse: 0.25,
  multimodal: 0.2,
  reuse: 0.15,
  handoff: 0.1
} as const;

export class ContextEfficiencyScorer {
  constructor(private readonly judge: EvaluationJudge) {}

  async score(
    bundle: RunBundle,
    accuracyScore: number
  ): Promise<ContextEfficiencyResult> {
    const participants = detectParticipants(bundle);
    const retryAttribution = await summarizeRetryAttribution(
      participants.flatMap((participant) => participant.failedToolCalls),
      this.judge
    );
    const participantContextScores = participants.map((participant) => ({
      participantId: participant.participantId,
      participantType: participant.participantType,
      complete: participant.complete,
      score: participant.complete ? scoreParticipant(participant) : 0
    }));
    const hasIncompleteSubagent = participantContextScores.some(
      (participant) => participant.participantType === "subagent" && !participant.complete
    );
    const rawScore = hasIncompleteSubagent
      ? 0
      : Math.min(...participantContextScores.map((participant) => participant.score));
    const threshold = bundle.example.evaluationSpec.minimumCorrectnessThreshold;
    const gatedScore = roundScore(rawScore * Math.min(1, accuracyScore / Math.max(threshold, 0.01)));
    const rootParticipant = participants[0];

    return {
      score: gatedScore,
      passed: !hasIncompleteSubagent && gatedScore >= 0.75,
      retryAttribution,
      participantContextScores,
      peerMetrics: {
        systemPromptTokens: rootParticipant?.systemPromptTokens ?? 0,
        toolDefinitionTokens: rootParticipant?.toolDefinitionTokens ?? 0,
        multimodalRawTokens: rootParticipant?.multimodalRawTokens ?? 0,
        multimodalCompressedTokens: rootParticipant?.multimodalCompressedTokens ?? 0,
        toolRetryCount: rootParticipant?.toolRetryCount ?? 0
      }
    };
  }
}

function detectParticipants(bundle: RunBundle): Participant[] {
  const metadata = bundle.agentMetadata as {
    contextMetrics?: AgentMetadataContextMetrics;
    toolCalls?: AgentMetadataToolCall[];
    multimodalNormalizationEvents?: AgentMetadataMultimodalEvent[];
    subagentEvents?: AgentMetadataSubagentEvent[];
  };
  const toolCalls = metadata.toolCalls ?? [];
  const multimodalEvents = metadata.multimodalNormalizationEvents ?? [];
  const contextMetrics = metadata.contextMetrics ?? {};
  const rootParticipant: Participant = {
    participantId: "supervisor",
    participantType: "supervisor",
    complete: true,
    systemPromptTokens: bundle.example.evaluationSpec.staticOverhead.systemPromptTokens,
    toolDefinitionTokens: bundle.example.evaluationSpec.staticOverhead.toolDefinitionTokens,
    totalInputTokens: bundle.tokenUsage.inputTokens,
    toolCallCount: toolCalls.filter((toolCall) => toolCall.status !== "skipped").length,
    toolRetryCount: toolCalls.filter((toolCall) => toolCall.status === "failed").length,
    multimodalRawTokens: multimodalEvents.reduce(
      (total, event) => total + (event.sourceTokenCount ?? 0),
      0
    ),
    multimodalCompressedTokens: multimodalEvents.reduce(
      (total, event) => total + (event.normalizedTokenCount ?? 0),
      0
    ),
    duplicateReadCount: countDuplicateReads(toolCalls),
    totalReadCount: toolCalls.reduce(
      (total, toolCall) => total + (toolCall.inputArtifactRefs?.length ?? 0),
      0
    ),
    unusedContextTokens: contextMetrics.unusedContextTokens ?? null,
    retrievedContextTokens:
      contextMetrics.retrievedContextTokens ??
      toolCalls.reduce((total, toolCall) => {
        const contextTokensUsed = toolCall as AgentMetadataToolCall & {
          contextTokensUsed?: number;
        };
        return total + (contextTokensUsed.contextTokensUsed ?? 0);
      }, 0),
    redundantHandoffTokens: 0,
    handoffPromptTokens: contextMetrics.subagentCommunicationTokens ?? 0,
    failedToolCalls: toolCalls.filter((toolCall) => toolCall.status === "failed")
  };
  const subagents = detectSubagents(bundle.trace, metadata.subagentEvents ?? []);

  return [rootParticipant, ...subagents];
}

function detectSubagents(
  trace: TraceExportRecord | null,
  subagentEvents: AgentMetadataSubagentEvent[]
): Participant[] {
  const traceSubagents = new Map<string, Participant>();

  for (const span of trace?.spans ?? []) {
    if (span.kind !== "subagent_call") {
      continue;
    }

    const subagentId =
      typeof span.metadata.subagentId === "string" && span.metadata.subagentId.length > 0
        ? span.metadata.subagentId
        : span.spanId;
    traceSubagents.set(subagentId, {
      participantId: subagentId,
      participantType: "subagent",
      complete: Boolean(span.startedAt && span.endedAt),
      systemPromptTokens: readNumberMetadata(span.metadata, "systemPromptTokens"),
      toolDefinitionTokens: readNumberMetadata(span.metadata, "toolDefinitionTokens"),
      totalInputTokens: readNumberMetadata(span.metadata, "totalInputTokens"),
      toolCallCount: readNumberMetadata(span.metadata, "toolCallCount"),
      toolRetryCount: readNumberMetadata(span.metadata, "toolRetryCount"),
      multimodalRawTokens: readNumberMetadata(span.metadata, "multimodalRawTokens"),
      multimodalCompressedTokens: readNumberMetadata(span.metadata, "multimodalCompressedTokens"),
      duplicateReadCount: readNumberMetadata(span.metadata, "duplicateReadCount"),
      totalReadCount: readNumberMetadata(span.metadata, "totalReadCount"),
      unusedContextTokens: readNullableNumberMetadata(span.metadata, "unusedContextTokens"),
      retrievedContextTokens: readNullableNumberMetadata(
        span.metadata,
        "retrievedContextTokens"
      ),
      redundantHandoffTokens: readNumberMetadata(span.metadata, "redundantHandoffTokens"),
      handoffPromptTokens: readNumberMetadata(span.metadata, "handoffPromptTokens"),
      failedToolCalls: []
    });
  }

  for (const subagentEvent of subagentEvents) {
    const subagentId = subagentEvent.subagentId;

    if (!subagentId) {
      continue;
    }

    if (!traceSubagents.has(subagentId)) {
      traceSubagents.set(subagentId, {
        participantId: subagentId,
        participantType: "subagent",
        complete: false,
        systemPromptTokens: 0,
        toolDefinitionTokens: 0,
        totalInputTokens: 0,
        toolCallCount: 0,
        toolRetryCount: 0,
        multimodalRawTokens: 0,
        multimodalCompressedTokens: 0,
        duplicateReadCount: 0,
        totalReadCount: 0,
        unusedContextTokens: null,
        retrievedContextTokens: null,
        redundantHandoffTokens: 0,
        handoffPromptTokens: 0,
        failedToolCalls: []
      });
    }
  }

  return [...traceSubagents.values()];
}

function scoreParticipant(participant: Participant): number {
  const componentEntries = [
    {
      weight: CONTEXT_WEIGHTS.staticOverhead,
      score:
        1 -
        clamp01(
          (participant.systemPromptTokens +
            participant.toolDefinitionTokens +
            participant.handoffPromptTokens) /
            Math.max(participant.totalInputTokens, 1)
        )
    },
    {
      weight: CONTEXT_WEIGHTS.toolUse,
      score: 1 - clamp01(participant.toolRetryCount / Math.max(participant.toolCallCount, 1))
    },
    {
      weight: CONTEXT_WEIGHTS.multimodal,
      score:
        participant.multimodalRawTokens === 0
          ? 1
          : 1 -
            clamp01(
              participant.multimodalCompressedTokens /
                Math.max(participant.multimodalRawTokens, 1)
            )
    },
    {
      weight: CONTEXT_WEIGHTS.reuse,
      score: 1 - clamp01(participant.duplicateReadCount / Math.max(participant.totalReadCount, 1))
    },
    {
      weight: CONTEXT_WEIGHTS.handoff,
      score:
        participant.handoffPromptTokens === 0
          ? 1
          : 1 -
            clamp01(
              participant.redundantHandoffTokens /
                Math.max(participant.handoffPromptTokens, 1)
            )
    }
  ];

  if (
    participant.unusedContextTokens !== null &&
    participant.retrievedContextTokens !== null &&
    participant.retrievedContextTokens > 0
  ) {
    componentEntries.push({
      weight: 0.1,
      score:
        1 -
        clamp01(
          participant.unusedContextTokens /
            Math.max(participant.retrievedContextTokens, 1)
        )
    });
  }

  const totalWeight = componentEntries.reduce((total, entry) => total + entry.weight, 0);
  const weightedScore = componentEntries.reduce(
    (total, entry) => total + entry.weight * entry.score,
    0
  );

  return roundScore(weightedScore / Math.max(totalWeight, 0.0001));
}

async function summarizeRetryAttribution(
  failedToolCalls: AgentMetadataToolCall[],
  judge: EvaluationJudge
) {
  const counts: EvaluatedExample["retryAttribution"] = {
    systemPromptVagueness: 0,
    toolDefinitionAmbiguity: 0,
    missingContext: 0,
    other: 0
  };

  for (const toolCall of failedToolCalls) {
    const label = await judge.classifyRetryAttribution({
        toolName: toolCall.toolName ?? "unknown-tool",
        inputSummary: toolCall.inputSummary ?? "",
        outputSummary: toolCall.outputSummary ?? ""
      });

    incrementRetryAttribution(counts, label);
  }

  return counts;
}

function incrementRetryAttribution(
  counts: EvaluatedExample["retryAttribution"],
  label: RetryAttributionLabel
) {
  if (label === "system_prompt_vagueness") {
    counts.systemPromptVagueness += 1;
    return;
  }

  if (label === "tool_definition_ambiguity") {
    counts.toolDefinitionAmbiguity += 1;
    return;
  }

  if (label === "missing_context") {
    counts.missingContext += 1;
    return;
  }

  counts.other += 1;
}

function countDuplicateReads(toolCalls: AgentMetadataToolCall[]): number {
  const seenArtifactRefs = new Set<string>();
  let duplicateReadCount = 0;

  for (const toolCall of toolCalls) {
    for (const artifactRef of toolCall.inputArtifactRefs ?? []) {
      if (seenArtifactRefs.has(artifactRef)) {
        duplicateReadCount += 1;
      } else {
        seenArtifactRefs.add(artifactRef);
      }
    }
  }

  return duplicateReadCount;
}

function readNumberMetadata(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNullableNumberMetadata(
  metadata: Record<string, unknown>,
  key: string
): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

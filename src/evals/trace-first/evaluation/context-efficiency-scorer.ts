import type { EvaluatedExample } from "../contracts/evaluated-example-schema.js";
import type { RunBundle, TraceExportRecord } from "../contracts/run-bundle-schema.js";
import type { EvaluationJudge, RetryAttributionLabel } from "./evaluation-judge.js";

type AgentMetadataContextMetrics = {
  promptTokens?: number;
  retrievedContextTokens?: number;
  relevantContextTokens?: number;
  unusedContextTokens?: number;
  subagentCommunicationTokens?: number;
};

type AgentMetadataToolCall = {
  toolName?: string;
  status?: string;
  inputSummary?: string;
  outputSummary?: string;
  outputArtifactRefs?: string[];
  inputArtifactRefs?: string[];
};

type AgentMetadataToolSpec = {
  toolName?: string;
  description?: string;
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
  diagnostics: EvaluatedExample["contextDiagnostics"];
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
    const metadata = bundle.agentMetadata as {
      contextMetrics?: AgentMetadataContextMetrics;
      toolCalls?: AgentMetadataToolCall[];
      toolSpecsCreated?: AgentMetadataToolSpec[];
      multimodalNormalizationEvents?: AgentMetadataMultimodalEvent[];
      subagentEvents?: AgentMetadataSubagentEvent[];
    };
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
    const diagnostics = buildContextDiagnostics({
      bundle,
      accuracyScore,
      rootParticipant,
      toolCalls: metadata.toolCalls ?? [],
      toolSpecsCreated: metadata.toolSpecsCreated ?? [],
      contextMetrics: metadata.contextMetrics ?? {}
    });

    return {
      score: gatedScore,
      passed: !hasIncompleteSubagent && gatedScore >= 0.75,
      retryAttribution,
      participantContextScores,
      diagnostics,
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

function buildContextDiagnostics(options: {
  bundle: RunBundle;
  accuracyScore: number;
  rootParticipant: Participant | undefined;
  toolCalls: AgentMetadataToolCall[];
  toolSpecsCreated: AgentMetadataToolSpec[];
  contextMetrics: AgentMetadataContextMetrics;
}): EvaluatedExample["contextDiagnostics"] {
  const rootParticipant = options.rootParticipant;
  const definedToolNames = [
    ...new Set(
      options.bundle.example.skills.length > 0
        ? options.bundle.example.skills.map((skill) => skill.skillId)
        : options.bundle.example.evaluationSpec.expectedActiveTools
    )
  ];
  const activeToolNames = [
    ...new Set(
      options.toolCalls
        .filter((toolCall) => toolCall.status !== "skipped")
        .map((toolCall) => toolCall.toolName)
        .filter((toolName): toolName is string => Boolean(toolName))
    )
  ];
  const relevantContextTokens = options.contextMetrics.relevantContextTokens ?? 0;
  const retrievedContextTokens = rootParticipant?.retrievedContextTokens ?? 0;
  const totalInputTokens = rootParticipant?.totalInputTokens ?? options.bundle.tokenUsage.inputTokens;
  const handoffPromptTokens = rootParticipant?.handoffPromptTokens ?? 0;
  const evaluationSpec = options.bundle.example.evaluationSpec;
  const staticContextEntries = [
    ...evaluationSpec.requiredContext,
    ...evaluationSpec.optionalContext,
    ...evaluationSpec.distractorContext,
    ...evaluationSpec.duplicateContext,
    ...evaluationSpec.staleContext
  ];
  const staticNoiseTokenCount = estimateTokenCount(
    [
      ...evaluationSpec.distractorContext,
      ...evaluationSpec.duplicateContext,
      ...evaluationSpec.staleContext
    ].join(" ")
  );
  const totalContextFootprint =
    (rootParticipant?.systemPromptTokens ?? 0) +
    (rootParticipant?.toolDefinitionTokens ?? 0) +
    retrievedContextTokens +
    handoffPromptTokens;
  const estimatedRequiredContextTokens = estimateTokenCount(
    (evaluationSpec.requiredContext.length > 0
      ? evaluationSpec.requiredContext
      : evaluationSpec.contextCheckpoints.map((checkpoint) => checkpoint.description))
      .join(" ")
  );
  const duplicateToolDefinitionRate = rate(
    countDuplicateToolDefinitions(options.toolSpecsCreated),
    Math.max(options.toolSpecsCreated.length, definedToolNames.length)
  );
  const toolOverlapRate = evaluationSpec.overlappingToolNames.length > 0
    ? rate(evaluationSpec.overlappingToolNames.length, definedToolNames.length)
    : rate(
        countOverlappingToolDefinitions(options.toolSpecsCreated),
        Math.max(options.toolSpecsCreated.length, definedToolNames.length)
      );
  const fileReadRedundancyRate = rate(
    rootParticipant?.duplicateReadCount ?? 0,
    rootParticipant?.totalReadCount ?? 0
  );
  const staticDuplicateContextRate = rate(
    evaluationSpec.duplicateContext.length,
    staticContextEntries.length
  );

  return {
    contextPrecision: roundScore(rate(relevantContextTokens, retrievedContextTokens, 1)),
    contextRecall: roundScore(
      rate(
        relevantContextTokens,
        estimatedRequiredContextTokens,
        evaluationSpec.requiredContext.length === 0 ? 1 : 0
      )
    ),
    systemPromptTokenOverhead: rootParticipant?.systemPromptTokens ?? 0,
    toolDefinitionTokenOverhead: rootParticipant?.toolDefinitionTokens ?? 0,
    tokenToValueRatio: roundValue(
      totalContextFootprint /
        Math.max(totalInputTokens * Math.max(options.accuracyScore, 0.01), 1)
    ),
    contextBloatIndex: roundScore(
      rate(
        (rootParticipant?.systemPromptTokens ?? 0) +
          (rootParticipant?.toolDefinitionTokens ?? 0) +
          (rootParticipant?.unusedContextTokens ?? 0) +
          staticNoiseTokenCount,
        totalInputTokens,
        0
      )
    ),
    duplicateContextRate: roundScore(
      Math.max(fileReadRedundancyRate, staticDuplicateContextRate)
    ),
    contextPartitionEfficiency: roundScore(1 - clamp01(handoffPromptTokens / Math.max(totalInputTokens, 1))),
    artifactReuseRate: roundScore(calculateArtifactReuseRate(options.toolCalls)),
    activeToolSurfaceArea: activeToolNames.length,
    unusedToolDefinitionRatio: roundScore(
      rate(Math.max(definedToolNames.length - activeToolNames.length, 0), definedToolNames.length, 0)
    ),
    duplicateToolDefinitionRate: roundScore(duplicateToolDefinitionRate),
    toolOverlapRate: roundScore(toolOverlapRate),
    fileReadRedundancyRate: roundScore(fileReadRedundancyRate)
  };
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

function countDuplicateToolDefinitions(toolSpecs: AgentMetadataToolSpec[]): number {
  const seenToolNames = new Set<string>();
  let duplicateCount = 0;

  for (const toolSpec of toolSpecs) {
    const toolName = toolSpec.toolName;

    if (!toolName) {
      continue;
    }

    if (seenToolNames.has(toolName)) {
      duplicateCount += 1;
      continue;
    }

    seenToolNames.add(toolName);
  }

  return duplicateCount;
}

function countOverlappingToolDefinitions(toolSpecs: AgentMetadataToolSpec[]): number {
  const descriptions = toolSpecs
    .map((toolSpec) => normalizeDescription(toolSpec.description))
    .filter((description): description is string => description.length > 0);
  const countsByDescription = new Map<string, number>();

  for (const description of descriptions) {
    countsByDescription.set(description, (countsByDescription.get(description) ?? 0) + 1);
  }

  let overlapCount = 0;

  for (const count of countsByDescription.values()) {
    if (count > 1) {
      overlapCount += count;
    }
  }

  return overlapCount;
}

function calculateArtifactReuseRate(toolCalls: AgentMetadataToolCall[]): number {
  const outputArtifactRefs = toolCalls.flatMap((toolCall) => toolCall.outputArtifactRefs ?? []);

  if (outputArtifactRefs.length === 0) {
    return 1;
  }

  const reusedOutputArtifactCount = toolCalls.reduce((total, toolCall) => {
    const inputArtifactRefs = new Set(toolCall.inputArtifactRefs ?? []);

    return (
      total +
      (toolCall.outputArtifactRefs ?? []).filter((artifactRef) =>
        inputArtifactRefs.has(artifactRef)
      ).length
    );
  }, 0);

  return rate(reusedOutputArtifactCount, outputArtifactRefs.length, 1);
}

function normalizeDescription(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function estimateTokenCount(text: string): number {
  const normalizedText = text.trim();

  if (normalizedText.length === 0) {
    return 0;
  }

  return Math.ceil(normalizedText.split(/\s+/).length * 1.3);
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

function rate(numerator: number, denominator: number, fallback = 0): number {
  if (denominator <= 0) {
    return fallback;
  }

  return clamp01(numerator / denominator);
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

function roundValue(value: number): number {
  return Number(value.toFixed(4));
}

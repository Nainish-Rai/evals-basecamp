import type { ModelTier } from "../../domain/agents/model-tier-schema.js";

export type WorkspaceRetrievalEvent = {
  retrievalId: string;
  sourceId: string;
  query: string;
  latencyMs: number;
  candidateCount: number;
  selectedCount: number;
  retrievedTokenCount: number;
  relevantTokenCount: number;
  selectedArtifactRefs: string[];
  relevantArtifactRefs: string[];
  usedArtifactRefs: string[];
};

export type WorkspaceSubagentEvent = {
  subagentId: string;
  model: string;
  modelTier: ModelTier;
  taskSummary: string;
  status: "completed" | "failed" | "cancelled";
};

export type WorkspaceMemoryCandidate = {
  candidateId: string;
  summary: string;
};

export type WorkspaceMemoryDecision = WorkspaceMemoryCandidate & {
  source: "trace_tool_file" | "user" | "pattern";
  scope: "step" | "case" | "cross_case";
  rationale: string;
};

export type WorkspaceMemoryRead = WorkspaceMemoryCandidate & {
  source: "trace_tool_file" | "user" | "pattern";
  scope: "step" | "case" | "cross_case";
  neededNow: boolean;
  usedInDecision: boolean;
  impact: "positive" | "neutral" | "negative";
};

export type WorkspaceContextMetrics = {
  contextWindowSizeTokens: number;
  promptTokens: number;
  retrievedContextTokens: number;
  relevantContextTokens: number;
  unusedContextTokens: number;
  workspaceArtifactTokens: number;
  subagentCommunicationTokens: number;
};

export type WorkspaceAgentMetadata = {
  graphPath: string[];
  groundedEvidenceRefs: string[];
  retrievalEvents: WorkspaceRetrievalEvent[];
  subagentEvents: WorkspaceSubagentEvent[];
  memoryCandidatesObserved: WorkspaceMemoryCandidate[];
  memoryReads: WorkspaceMemoryRead[];
  memoryWrites: WorkspaceMemoryDecision[];
  memoryWritesSkipped: WorkspaceMemoryDecision[];
  contextMetrics: WorkspaceContextMetrics;
  latencyMs: number;
};

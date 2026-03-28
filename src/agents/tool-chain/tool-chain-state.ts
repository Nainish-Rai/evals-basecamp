export type ToolChainTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ToolChainToolSpec = {
  toolName: string;
  description: string;
  inputSchemaSummary?: string;
  reusedExistingTool: boolean;
};

export type ToolChainToolCreationEvent = {
  toolName: string;
  createdDuringRun: boolean;
  rationale: string;
};

export type ToolCallStatus = "succeeded" | "failed" | "skipped";

export type ToolChainToolCall = {
  callId: string;
  toolName: string;
  status: ToolCallStatus;
  latencyMs: number;
  inputSummary: string;
  outputSummary: string;
  consumedBudget: number;
  contextTokensUsed: number;
  inputArtifactRefs: string[];
  outputArtifactRefs: string[];
};

export type ToolChainBudgetLedgerEntry = {
  budgetName: string;
  scope: "run" | "turn" | "tool" | "subagent";
  allocated: number;
  consumed: number;
  remaining: number;
  unit: "tools" | "tokens" | "seconds";
  withinBudget: boolean;
};

export type ToolChainFeedbackEvent = {
  feedbackId: string;
  summary: string;
  instructionCount: number;
  correctedFactCount: number;
};

export type ToolChainMemoryCandidate = {
  candidateId: string;
  summary: string;
};

export type ToolChainMemoryDecision = ToolChainMemoryCandidate & {
  source: "trace_tool_file" | "user" | "pattern";
  scope: "step" | "case" | "cross_case";
  rationale: string;
};

export type ToolChainMemoryRead = ToolChainMemoryCandidate & {
  source: "trace_tool_file" | "user" | "pattern";
  scope: "step" | "case" | "cross_case";
  neededNow: boolean;
  usedInDecision: boolean;
  impact: "positive" | "neutral" | "negative";
};

export type ToolChainMultimodalNormalizationEvent = {
  modality: string;
  strategy: "inline_summary" | "structured_summary";
  sourceArtifactRefs: string[];
  sourceTokenCount: number;
  normalizedTokenCount: number;
};

export type ToolChainState = {
  graphPath: string[];
  toolSpecsCreated: ToolChainToolSpec[];
  toolCreationEvents: ToolChainToolCreationEvent[];
  toolCalls: ToolChainToolCall[];
  budgetLedger: ToolChainBudgetLedgerEntry[];
  feedbackLedger: ToolChainFeedbackEvent[];
  memoryCandidatesObserved: ToolChainMemoryCandidate[];
  memoryWrites: ToolChainMemoryDecision[];
  memoryWritesSkipped: ToolChainMemoryDecision[];
  memoryReads: ToolChainMemoryRead[];
  multimodalNormalizationEvents: ToolChainMultimodalNormalizationEvent[];
  groundedEvidenceRefs: string[];
  tokenUsage: ToolChainTokenUsage;
};

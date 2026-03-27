export type ToolChainState = {
  toolCatalog: string[];
  toolCreationEvents: string[];
  toolCallLedger: string[];
  budgetLedger: string[];
  feedbackLedger: string[];
  caseMemory: string[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

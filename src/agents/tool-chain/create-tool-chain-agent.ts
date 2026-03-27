import type { ToolChainState } from "./tool-chain-state.js";

export function createToolChainInitialState(): ToolChainState {
  return {
    toolCatalog: [],
    toolCreationEvents: [],
    toolCallLedger: [],
    budgetLedger: [],
    feedbackLedger: [],
    caseMemory: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }
  };
}

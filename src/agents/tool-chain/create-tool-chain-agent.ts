import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { MaterializedCaseEnvironment } from "../../runtime/materialization/case-environment-materializer.js";
import type {
  ScenarioAgent,
  ScenarioAgentRunRequest,
  ScenarioAgentRunResult
} from "../../runtime/runner/stub-scenario-agent.js";
import type { ScenarioExecutionPlan } from "../../runtime/runner/feedback-replay-engine.js";
import type {
  ToolChainBudgetLedgerEntry,
  ToolChainFeedbackEvent,
  ToolChainMemoryDecision,
  ToolChainMemoryRead,
  ToolChainMultimodalNormalizationEvent,
  ToolChainState,
  ToolChainToolCall,
  ToolChainToolCreationEvent,
  ToolChainToolSpec
} from "./tool-chain-state.js";

export type ToolChainAgentOptions = {
  toolCallBudget?: number;
  contextWindowSizeTokens?: number;
  defaultToolLatencyMs?: number;
};

type ToolChainAgentMetadata = {
  graphPath: string[];
  groundedEvidenceRefs: string[];
  toolSpecsCreated: ToolChainToolSpec[];
  toolCreationEvents: ToolChainToolCreationEvent[];
  toolCalls: ToolChainToolCall[];
  budgetLedger: ToolChainBudgetLedgerEntry[];
  memoryCandidatesObserved: ToolChainState["memoryCandidatesObserved"];
  memoryWrites: ToolChainState["memoryWrites"];
  memoryWritesSkipped: ToolChainState["memoryWritesSkipped"];
  memoryReads: ToolChainState["memoryReads"];
  multimodalNormalizationEvents: ToolChainMultimodalNormalizationEvent[];
  contextMetrics: {
    contextWindowSizeTokens: number;
    promptTokens: number;
    retrievedContextTokens: number;
    relevantContextTokens: number;
    unusedContextTokens: number;
    workspaceArtifactTokens: number;
    subagentCommunicationTokens: number;
  };
  stateSnapshot: ToolChainState;
};

const DEFAULT_CONTEXT_WINDOW_SIZE_TOKENS = 128_000;
const DEFAULT_TOOL_LATENCY_MS = 14;

export function createToolChainInitialState(): ToolChainState {
  return {
    graphPath: [],
    toolSpecsCreated: [],
    toolCreationEvents: [],
    toolCalls: [],
    budgetLedger: [],
    feedbackLedger: [],
    memoryCandidatesObserved: [],
    memoryWrites: [],
    memoryWritesSkipped: [],
    memoryReads: [],
    multimodalNormalizationEvents: [],
    groundedEvidenceRefs: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }
  };
}

export function createToolChainScenarioAgent(
  options: ToolChainAgentOptions = {}
): ScenarioAgent {
  return new ToolChainScenarioAgent(options);
}

class ToolChainScenarioAgent implements ScenarioAgent {
  constructor(private readonly options: ToolChainAgentOptions) {}

  async run(request: ScenarioAgentRunRequest): Promise<ScenarioAgentRunResult> {
    return request.trace.runInSpan(
      {
        name: "tool_chain_agent_run",
        kind: "graph_node",
        metadata: {
          scenarioId: request.scenario.scenarioId,
          executionMode: request.executionPlan.mode
        }
      },
      () => Promise.resolve(this.execute(request))
    );
  }

  private execute(
    request: ScenarioAgentRunRequest
  ): ScenarioAgentRunResult {
    const state = createToolChainInitialState();

    state.graphPath = buildGraphPath(request.scenario, request.executionPlan);
    state.toolSpecsCreated = createToolSpecs(request.scenario);
    state.toolCreationEvents = createToolCreationEvents(state.toolSpecsCreated);
    state.feedbackLedger = createFeedbackLedger(request.executionPlan);
    state.multimodalNormalizationEvents = createMultimodalNormalizationEvents(
      request.scenario,
      request.environment
    );
    state.groundedEvidenceRefs = collectGroundedEvidenceRefs(request.scenario);
    state.memoryCandidatesObserved = collectMemoryCandidates(request.scenario);
    state.memoryWrites = collectMemoryWrites(request.scenario, request.executionPlan);
    state.memoryWritesSkipped = collectSkippedMemoryWrites(
      request.scenario,
      request.executionPlan
    );
    state.memoryReads = collectMemoryReads(request.scenario, request.executionPlan);

    for (const memoryCandidate of state.memoryCandidatesObserved) {
      request.trace.recordMemoryDecision({
        type: "observed_candidate",
        candidateId: memoryCandidate.candidateId,
        summary: memoryCandidate.summary
      });
    }

    for (const memoryWrite of state.memoryWrites) {
      request.trace.recordMemoryDecision({
        type: "saved",
        candidateId: memoryWrite.candidateId,
        summary: memoryWrite.summary,
        source: memoryWrite.source,
        scope: memoryWrite.scope,
        rationale: memoryWrite.rationale
      });
    }

    for (const skippedWrite of state.memoryWritesSkipped) {
      request.trace.recordMemoryDecision({
        type: "skipped_save",
        candidateId: skippedWrite.candidateId,
        summary: skippedWrite.summary,
        source: skippedWrite.source,
        scope: skippedWrite.scope,
        rationale: skippedWrite.rationale
      });
    }

    for (const memoryRead of state.memoryReads) {
      request.trace.recordMemoryDecision({
        type: memoryRead.usedInDecision ? "used_in_decision" : "retrieved",
        candidateId: memoryRead.candidateId,
        summary: memoryRead.summary,
        source: memoryRead.source,
        scope: memoryRead.scope,
        rationale: `neededNow=${memoryRead.neededNow}`
      });
    }

    state.toolCalls = createToolCalls(
      request,
      state.toolSpecsCreated,
      this.options.toolCallBudget,
      this.options.defaultToolLatencyMs ?? DEFAULT_TOOL_LATENCY_MS
    );
    state.budgetLedger = createBudgetLedger(
      request.scenario,
      state.toolCalls,
      this.options.toolCallBudget
    );
    state.tokenUsage = calculateTokenUsage(
      request.scenario,
      request.environment,
      request.executionPlan,
      state
    );

    const finalResponse = composeFinalResponse(request.scenario, request.executionPlan, state);

    return {
      summary: finalResponse,
      outputArtifacts: state.toolCalls.flatMap((toolCall) => toolCall.outputArtifactRefs),
      tokenUsage: state.tokenUsage,
      metadata: createMetadata(
        request.scenario,
        request.environment,
        state,
        this.options.contextWindowSizeTokens ?? DEFAULT_CONTEXT_WINDOW_SIZE_TOKENS
      )
    };
  }
}

function buildGraphPath(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): string[] {
  const orderedNodes = [
    ...scenario.trajectoryHints.expectedNodes,
    ...scenario.driftEvaluationSpec.trajectory.requiredSteps
  ];

  if (executionPlan.feedbackTurns.length > 0 && !orderedNodes.includes("applyFeedback")) {
    orderedNodes.splice(Math.max(orderedNodes.length - 1, 0), 0, "applyFeedback");
  }

  return [...new Set(orderedNodes)];
}

function createToolSpecs(scenario: Scenario): ToolChainToolSpec[] {
  return scenario.availableTools.map((toolName) => ({
    toolName,
    description: describeTool(toolName, scenario.taskFamily),
    inputSchemaSummary: describeToolInput(toolName),
    reusedExistingTool: true
  }));
}

function createToolCreationEvents(
  toolSpecs: ToolChainToolSpec[]
): ToolChainToolCreationEvent[] {
  return toolSpecs.map((toolSpec) => ({
    toolName: toolSpec.toolName,
    createdDuringRun: false,
    rationale: "Reused the scenario-provided tool definition."
  }));
}

function createFeedbackLedger(
  executionPlan: ScenarioExecutionPlan
): ToolChainFeedbackEvent[] {
  return executionPlan.feedbackTurns.map((feedbackTurn) => ({
    feedbackId: feedbackTurn.feedbackId,
    summary: feedbackTurn.summary,
    instructionCount: feedbackTurn.instructions.length,
    correctedFactCount: feedbackTurn.correctedFacts.length
  }));
}

function createMultimodalNormalizationEvents(
  scenario: Scenario,
  environment: MaterializedCaseEnvironment
): ToolChainMultimodalNormalizationEvent[] {
  const nonTextModalities = scenario.modalityProfile.filter((modality) => modality !== "text");

  if (nonTextModalities.length === 0) {
    return [];
  }

  const sourceArtifactRefs = environment.registryEntries
    .slice(0, Math.max(environment.registryEntries.length, 1))
    .map((entry) => entry.sourceId);

  return nonTextModalities.map((modality) => ({
    modality,
    strategy: modality === "pdf" || modality === "table"
      ? "structured_summary"
      : "inline_summary",
    sourceArtifactRefs,
    sourceTokenCount: 120,
    normalizedTokenCount: 40
  }));
}

function collectGroundedEvidenceRefs(scenario: Scenario): string[] {
  return [
    ...new Set(
      scenario.expectedOutcomes.flatMap((expectedOutcome) => expectedOutcome.requiredEvidenceRefs)
    )
  ];
}

function collectMemoryCandidates(scenario: Scenario): ToolChainState["memoryCandidatesObserved"] {
  return (
    scenario.memoryEvaluationSpec?.memoryOpportunities.map((opportunity) => ({
      candidateId: opportunity.opportunityId,
      summary: opportunity.summary
    })) ?? []
  );
}

function collectMemoryWrites(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): ToolChainMemoryDecision[] {
  if (executionPlan.feedbackTurns.length === 0) {
    return [];
  }

  return (
    scenario.memoryEvaluationSpec?.memoryOpportunities
      .filter((opportunity) => opportunity.worthKeeping)
      .map((opportunity) => ({
        candidateId: opportunity.opportunityId,
        summary: opportunity.summary,
        source: opportunity.source,
        scope: opportunity.scope,
        rationale: "Stored because the scenario marks this memory as worth keeping."
      })) ?? []
  );
}

function collectSkippedMemoryWrites(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): ToolChainMemoryDecision[] {
  if (executionPlan.feedbackTurns.length === 0) {
    return [];
  }

  return (
    scenario.memoryEvaluationSpec?.memoryOpportunities
      .filter((opportunity) => !opportunity.worthKeeping)
      .map((opportunity) => ({
        candidateId: opportunity.opportunityId,
        summary: opportunity.summary,
        source: opportunity.source,
        scope: opportunity.scope,
        rationale: "Skipped because the scenario marks this memory as not worth keeping."
      })) ?? []
  );
}

function collectMemoryReads(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): ToolChainMemoryRead[] {
  if (executionPlan.mode !== "feedback_rerun") {
    return [];
  }

  return (
    scenario.memoryEvaluationSpec?.memoryOpportunities
      .filter((opportunity) => opportunity.neededLater)
      .map((opportunity) => ({
        candidateId: opportunity.opportunityId,
        summary: opportunity.summary,
        source: opportunity.source,
        scope: opportunity.scope,
        neededNow: true,
        usedInDecision: opportunity.worthKeeping,
        impact: scenario.memoryEvaluationSpec?.expectedMemoryImpact ?? "neutral"
      })) ?? []
  );
}

function createToolCalls(
  request: ScenarioAgentRunRequest,
  toolSpecs: ToolChainToolSpec[],
  toolCallBudget: number | undefined,
  defaultToolLatencyMs: number
): ToolChainToolCall[] {
  const selectedToolNames = selectToolNames(request.scenario);
  const budgetLimit = resolveToolBudget(request.scenario, toolCallBudget);
  const toolCalls: ToolChainToolCall[] = [];

  for (const [index, toolName] of selectedToolNames.entries()) {
    const callId = `${request.scenario.scenarioId}-tool-call-${index + 1}`;
    const toolSpec = toolSpecs.find((candidate) => candidate.toolName === toolName);
    const skippedForBudget = index >= budgetLimit;
    const ambiguousToolFailure = shouldFailToolCall(
      request.scenario,
      request.executionPlan,
      toolName,
      index
    );
    const inputArtifactRefs = request.environment.registryEntries
      .slice(0, 2)
      .map((entry) => entry.sourceId);

    if (skippedForBudget) {
      const skippedCall: ToolChainToolCall = {
        callId,
        toolName,
        status: "skipped",
        latencyMs: 0,
        inputSummary: buildToolInputSummary(request.scenario, request.executionPlan, toolName),
        outputSummary: "Skipped because the tool-call budget was exhausted.",
        consumedBudget: 0,
        contextTokensUsed: 0,
        inputArtifactRefs,
        outputArtifactRefs: []
      };

      toolCalls.push(skippedCall);
      request.trace.recordEvent("tool_call_skipped", {
        toolName,
        callId,
        reason: "budget_exhausted"
      });
      continue;
    }

    const latencyMs = defaultToolLatencyMs + index * 3;
    const outputArtifactRefs = collectOutputArtifactRefs(request.scenario, request.environment);
    const toolCall: ToolChainToolCall = {
      callId,
      toolName,
      status: ambiguousToolFailure ? "failed" : "succeeded",
      latencyMs,
      inputSummary: buildToolInputSummary(request.scenario, request.executionPlan, toolName),
      outputSummary: ambiguousToolFailure
        ? "Ambiguous tool framing caused a retry without introducing new facts."
        : buildToolOutputSummary(request.scenario, toolName, toolSpec),
      consumedBudget: 1,
      contextTokensUsed: 110 + index * 15,
      inputArtifactRefs,
      outputArtifactRefs: ambiguousToolFailure ? [] : outputArtifactRefs
    };

    toolCalls.push(toolCall);
    request.trace.recordEvent("tool_call_recorded", {
      toolName,
      callId,
      status: toolCall.status
    });
  }

  return toolCalls;
}

function selectToolNames(scenario: Scenario): string[] {
  return [
    ...new Set([
      ...scenario.driftEvaluationSpec.trajectory.criticalTools,
      ...scenario.contextEvaluationSpec.toolSurfaceProfile.expectedActiveTools,
      ...scenario.availableTools
    ])
  ];
}

function shouldFailToolCall(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan,
  toolName: string,
  index: number
): boolean {
  if (executionPlan.mode !== "initial") {
    return false;
  }

  return (
    scenario.contextEvaluationSpec.toolSurfaceProfile.duplicateToolRisk === "high" &&
    scenario.contextEvaluationSpec.toolSurfaceProfile.overlappingToolNames.includes(toolName) &&
    index > 0
  );
}

function collectOutputArtifactRefs(
  scenario: Scenario,
  environment: MaterializedCaseEnvironment
): string[] {
  const requiredEvidenceRefs = collectGroundedEvidenceRefs(scenario);

  if (requiredEvidenceRefs.length > 0) {
    return requiredEvidenceRefs;
  }

  return environment.registryEntries.slice(0, 2).map((entry) => entry.sourceId);
}

function buildToolInputSummary(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan,
  toolName: string
): string {
  const feedbackSuffix =
    executionPlan.feedbackTurns.length > 0 ? " + reviewer feedback corrections" : "";

  return `tool=${toolName}; task=${scenario.taskFamily}; brief=${scenario.caseBrief}${feedbackSuffix}`;
}

function buildToolOutputSummary(
  scenario: Scenario,
  toolName: string,
  toolSpec: ToolChainToolSpec | undefined
): string {
  const findingSummary = scenario.expectedOutcomes[0]?.summary ?? scenario.caseBrief;
  const toolDescription = toolSpec?.description ?? "Resolved the requested domain lookup.";

  return `${toolDescription} ${findingSummary}`;
}

function createBudgetLedger(
  scenario: Scenario,
  toolCalls: ToolChainToolCall[],
  overrideBudget: number | undefined
): ToolChainBudgetLedgerEntry[] {
  const allocated = resolveToolBudget(scenario, overrideBudget);
  const consumed = toolCalls.filter((toolCall) => toolCall.consumedBudget > 0).length;

  return [
    {
      budgetName: "tool_calls",
      scope: "run",
      allocated,
      consumed,
      remaining: Math.max(allocated - consumed, 0),
      unit: "tools",
      withinBudget: consumed <= allocated
    }
  ];
}

function resolveToolBudget(scenario: Scenario, overrideBudget: number | undefined): number {
  if (overrideBudget !== undefined) {
    return overrideBudget;
  }

  const expectedToolCount =
    scenario.contextEvaluationSpec.toolSurfaceProfile.expectedActiveTools.length;

  return Math.max(2, Math.min(expectedToolCount, 4));
}

function calculateTokenUsage(
  scenario: Scenario,
  environment: MaterializedCaseEnvironment,
  executionPlan: ScenarioExecutionPlan,
  state: ToolChainState
): ToolChainState["tokenUsage"] {
  const promptTokens =
    scenario.contextEvaluationSpec.systemPromptProfile.fixedTokenOverhead +
    scenario.contextEvaluationSpec.systemPromptProfile.dynamicTokenOverhead +
    scenario.contextEvaluationSpec.toolSurfaceProfile.toolDefinitionTokenOverhead;
  const toolContextTokens = state.toolCalls.reduce(
    (tokenCount, toolCall) => tokenCount + toolCall.contextTokensUsed,
    0
  );
  const feedbackTokens = executionPlan.feedbackTurns.reduce(
    (tokenCount, feedbackTurn) =>
      tokenCount +
      feedbackTurn.summary.length +
      feedbackTurn.instructions.join(" ").length +
      feedbackTurn.correctedFacts.join(" ").length,
    0
  );
  const normalizationTokens = state.multimodalNormalizationEvents.reduce(
    (tokenCount, event) => tokenCount + event.normalizedTokenCount,
    0
  );
  const inputTokens =
    promptTokens +
    toolContextTokens +
    Math.ceil(feedbackTokens / 4) +
    normalizationTokens +
    environment.registryEntries.length * 5;
  const outputTokens = Math.max(
    80,
    Math.ceil(composeFinalResponse(scenario, executionPlan, state).length / 4)
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  };
}

function composeFinalResponse(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan,
  state: ToolChainState
): string {
  const outcomeSummary = scenario.expectedOutcomes
    .map((expectedOutcome) => expectedOutcome.summary)
    .join(" ");
  const disposition = scenario.driftEvaluationSpec.expectedOutcomeCriteria.expectedDisposition;
  const feedbackSummary = executionPlan.feedbackTurns
    .map((feedbackTurn) => feedbackTurn.summary)
    .join(" ");
  const failedToolSummary = state.toolCalls
    .filter((toolCall) => toolCall.status === "failed")
    .map((toolCall) => toolCall.outputSummary)
    .join(" ");

  return [
    outcomeSummary,
    `Disposition: ${disposition}.`,
    feedbackSummary,
    failedToolSummary
  ]
    .filter((segment) => segment.length > 0)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function createMetadata(
  scenario: Scenario,
  environment: MaterializedCaseEnvironment,
  state: ToolChainState,
  contextWindowSizeTokens: number
): ToolChainAgentMetadata {
  const promptTokens =
    scenario.contextEvaluationSpec.systemPromptProfile.fixedTokenOverhead +
    scenario.contextEvaluationSpec.systemPromptProfile.dynamicTokenOverhead +
    scenario.contextEvaluationSpec.toolSurfaceProfile.toolDefinitionTokenOverhead;
  const retrievedContextTokens = state.toolCalls.reduce(
    (tokenCount, toolCall) => tokenCount + toolCall.contextTokensUsed,
    0
  );
  const relevantContextTokens = Math.max(
    retrievedContextTokens -
      scenario.contextEvaluationSpec.duplicateContext.length * 30 -
      scenario.contextEvaluationSpec.distractorContext.length * 20,
    0
  );

  return {
    graphPath: state.graphPath,
    groundedEvidenceRefs: state.groundedEvidenceRefs,
    toolSpecsCreated: state.toolSpecsCreated,
    toolCreationEvents: state.toolCreationEvents,
    toolCalls: state.toolCalls,
    budgetLedger: state.budgetLedger,
    memoryCandidatesObserved: state.memoryCandidatesObserved,
    memoryWrites: state.memoryWrites,
    memoryWritesSkipped: state.memoryWritesSkipped,
    memoryReads: state.memoryReads,
    multimodalNormalizationEvents: state.multimodalNormalizationEvents,
    contextMetrics: {
      contextWindowSizeTokens,
      promptTokens,
      retrievedContextTokens,
      relevantContextTokens,
      unusedContextTokens: Math.max(retrievedContextTokens - relevantContextTokens, 0),
      workspaceArtifactTokens: environment.registryEntries.length * 15,
      subagentCommunicationTokens: 0
    },
    stateSnapshot: state
  };
}

function describeTool(toolName: string, taskFamily: Scenario["taskFamily"]): string {
  if (toolName.includes("policy")) {
    return `Searches policy context relevant to ${taskFamily} work.`;
  }

  if (toolName.includes("lookup") || toolName.includes("search")) {
    return `Retrieves ${taskFamily} evidence needed for the current case.`;
  }

  if (toolName.includes("writer")) {
    return `Produces a concise ${taskFamily} narrative from the gathered evidence.`;
  }

  return `Executes a ${taskFamily} case step required by the scenario.`;
}

function describeToolInput(toolName: string): string {
  if (toolName.includes("search")) {
    return "query: string";
  }

  if (toolName.includes("lookup")) {
    return "recordId?: string, query?: string";
  }

  if (toolName.includes("writer")) {
    return "evidenceSummary: string";
  }

  return "input: object";
}

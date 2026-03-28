import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isStrictlySmallerModelTier,
  type ModelTier
} from "../../domain/agents/model-tier-schema.js";
import type { ArtifactRegistryEntry } from "../../runtime/artifacts/artifact-registry.js";
import type { MaterializedCaseEnvironment } from "../../runtime/materialization/case-environment-materializer.js";
import type {
  ScenarioAgent,
  ScenarioAgentRunRequest,
  ScenarioAgentRunResult
} from "../../runtime/runner/stub-scenario-agent.js";
import type { ScenarioExecutionPlan } from "../../runtime/runner/feedback-replay-engine.js";
import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type {
  WorkspaceAgentMetadata,
  WorkspaceContextMetrics,
  WorkspaceMemoryDecision,
  WorkspaceMemoryRead,
  WorkspaceRetrievalEvent,
  WorkspaceSubagentEvent
} from "./workspace-state.js";

export type WorkspaceAgentOptions = {
  mainModel?: string;
  mainModelTier?: ModelTier;
  subagentModel?: string;
  subagentModelTier?: ModelTier;
  contextWindowSizeTokens?: number;
  retrievalLatencyMs?: number;
  subagentLatencyMs?: number;
};

type RetrievedDocument = {
  entry: ArtifactRegistryEntry;
  content: string;
  tokenCount: number;
};

type WorkspaceExecutionState = {
  graphPath: string[];
  groundedEvidenceRefs: string[];
  retrievalEvents: WorkspaceRetrievalEvent[];
  subagentEvents: WorkspaceSubagentEvent[];
  memoryCandidatesObserved: WorkspaceAgentMetadata["memoryCandidatesObserved"];
  memoryReads: WorkspaceMemoryRead[];
  memoryWrites: WorkspaceMemoryDecision[];
  memoryWritesSkipped: WorkspaceMemoryDecision[];
  retrievedDocuments: RetrievedDocument[];
  outputArtifacts: string[];
  contextMetrics: WorkspaceContextMetrics;
  latencyMs: number;
};

const DEFAULT_CONTEXT_WINDOW_SIZE_TOKENS = 128_000;
const DEFAULT_RETRIEVAL_LATENCY_MS = 18;
const DEFAULT_SUBAGENT_LATENCY_MS = 35;
const DEFAULT_MAIN_MODEL = "gpt-5.4";
const DEFAULT_SUBAGENT_MODEL = "gpt-5.4-mini";
const DEFAULT_MAIN_MODEL_TIER: ModelTier = "large";
const DEFAULT_SUBAGENT_MODEL_TIER: ModelTier = "medium";

export function createWorkspaceScenarioAgent(
  options: WorkspaceAgentOptions = {}
): ScenarioAgent {
  return new WorkspaceScenarioAgent(options);
}

class WorkspaceScenarioAgent implements ScenarioAgent {
  private readonly mainModel: string;
  private readonly mainModelTier: ModelTier;
  private readonly subagentModel: string;
  private readonly subagentModelTier: ModelTier;
  private readonly contextWindowSizeTokens: number;
  private readonly retrievalLatencyMs: number;
  private readonly subagentLatencyMs: number;

  constructor(options: WorkspaceAgentOptions) {
    this.mainModel = options.mainModel ?? DEFAULT_MAIN_MODEL;
    this.mainModelTier = options.mainModelTier ?? DEFAULT_MAIN_MODEL_TIER;
    this.subagentModel = options.subagentModel ?? DEFAULT_SUBAGENT_MODEL;
    this.subagentModelTier = options.subagentModelTier ?? DEFAULT_SUBAGENT_MODEL_TIER;
    this.contextWindowSizeTokens =
      options.contextWindowSizeTokens ?? DEFAULT_CONTEXT_WINDOW_SIZE_TOKENS;
    this.retrievalLatencyMs = options.retrievalLatencyMs ?? DEFAULT_RETRIEVAL_LATENCY_MS;
    this.subagentLatencyMs = options.subagentLatencyMs ?? DEFAULT_SUBAGENT_LATENCY_MS;

    if (!isStrictlySmallerModelTier(this.subagentModelTier, this.mainModelTier)) {
      throw new Error(
        "Workspace subagent model tier must be strictly smaller than the main model tier."
      );
    }
  }

  async run(request: ScenarioAgentRunRequest): Promise<ScenarioAgentRunResult> {
    return request.trace.runInSpan(
      {
        name: "workspace_agent_run",
        kind: "graph_node",
        metadata: {
          scenarioId: request.scenario.scenarioId,
          executionMode: request.executionPlan.mode,
          mainModel: this.mainModel,
          subagentModel: this.subagentModel
        }
      },
      async () => this.execute(request)
    );
  }

  private async execute(
    request: ScenarioAgentRunRequest
  ): Promise<ScenarioAgentRunResult> {
    const state = createWorkspaceExecutionState(
      request.scenario,
      request.executionPlan,
      this.contextWindowSizeTokens
    );

    state.retrievedDocuments = await this.retrieveContext(request, state);
    state.outputArtifacts = await this.curateWorkspace(request, state);
    state.subagentEvents = await this.runSubagent(request, state);
    applyMemoryDecisions(request, state);
    state.contextMetrics = await buildContextMetrics(
      request,
      state,
      this.contextWindowSizeTokens
    );

    const summary = buildFinalSummary(request, state);

    return {
      summary,
      outputArtifacts: state.outputArtifacts,
      tokenUsage: calculateTokenUsage(request, state),
      metadata: {
        graphPath: state.graphPath,
        groundedEvidenceRefs: state.groundedEvidenceRefs,
        retrievalEvents: state.retrievalEvents,
        subagentEvents: state.subagentEvents,
        memoryCandidatesObserved: state.memoryCandidatesObserved,
        memoryReads: state.memoryReads,
        memoryWrites: state.memoryWrites,
        memoryWritesSkipped: state.memoryWritesSkipped,
        contextMetrics: state.contextMetrics,
        latencyMs: state.latencyMs
      } satisfies WorkspaceAgentMetadata
    };
  }

  private async retrieveContext(
    request: ScenarioAgentRunRequest,
    state: WorkspaceExecutionState
  ): Promise<RetrievedDocument[]> {
    const retrievalTargets = selectRetrievalTargets(
      request.scenario,
      request.environment
    );
    const candidateCount = retrievalTargets.length;
    const selectedEntries = retrievalTargets.filter((target) => target.isSelected);
    const retrievedDocuments = await Promise.all(
      selectedEntries.map(async ({ entry }) => ({
        entry,
        content: await readFile(entry.path, "utf8"),
        tokenCount: estimateTextTokens(entry.path)
      }))
    );

    const retrievalEvent = await request.trace.runInSpan(
      {
        name: "workspace_context_retrieval",
        kind: "retrieval",
        metadata: {
          selectedCount: selectedEntries.length,
          candidateCount
        }
      },
      async () => ({
        retrievalId: `${request.runId}-retrieval-1`,
        sourceId: selectedEntries.at(0)?.entry.sourceId ?? "workspace-index",
        query: buildRetrievalQuery(request.scenario, request.executionPlan),
        latencyMs: this.retrievalLatencyMs,
        candidateCount,
        selectedCount: selectedEntries.length,
        retrievedTokenCount: retrievedDocuments.reduce(
          (total, document) => total + document.tokenCount,
          0
        ),
        relevantTokenCount: retrievedDocuments.reduce(
          (total, document) => total + document.tokenCount,
          0
        ),
        selectedArtifactRefs: selectedEntries.map(({ entry }) => entry.sourceId),
        relevantArtifactRefs: collectRelevantArtifactRefs(request.scenario, selectedEntries),
        usedArtifactRefs: selectedEntries.map(({ entry }) => entry.sourceId)
      })
    );

    state.retrievalEvents = [retrievalEvent];
    state.latencyMs += retrievalEvent.latencyMs;
    return retrievedDocuments;
  }

  private async curateWorkspace(
    request: ScenarioAgentRunRequest,
    state: WorkspaceExecutionState
  ): Promise<string[]> {
    const curatedNoteDirectory = path.join(request.environment.workspacePath, "notes");
    const curatedNotePath = path.join(
      curatedNoteDirectory,
      `${request.scenario.taskFamily}-curated-note.md`
    );
    const finalAnswerDirectory = path.join(request.environment.workspacePath, "outputs");
    const finalAnswerPath = path.join(
      finalAnswerDirectory,
      `${request.scenario.taskFamily}-final-answer.md`
    );
    const retrievalLines = state.retrievedDocuments.map((document) =>
      `- ${document.entry.title} (${document.entry.sourceId})`
    );
    const feedbackLines = request.executionPlan.feedbackTurns.flatMap((feedbackTurn) => [
      `- ${feedbackTurn.summary}`,
      ...feedbackTurn.correctedFacts.map((fact) => `  corrected: ${fact}`)
    ]);
    const curatedNote = [
      `# ${request.scenario.title}`,
      "",
      `runId: ${request.runId}`,
      `mode: ${request.executionPlan.mode}`,
      "",
      "## Selected Inputs",
      ...retrievalLines,
      "",
      "## Key Context",
      ...buildCuratedContextLines(request.scenario, state.retrievedDocuments),
      "",
      "## Feedback",
      ...(feedbackLines.length > 0 ? feedbackLines : ["- none"])
    ].join("\n");

    await request.trace.runInSpan(
      {
        name: "workspace_curated_write",
        kind: "workspace_write",
        metadata: {
          path: curatedNotePath
        }
      },
      async () => {
        await mkdir(curatedNoteDirectory, { recursive: true });
        await mkdir(finalAnswerDirectory, { recursive: true });
        await writeFile(curatedNotePath, curatedNote, "utf8");
        await writeFile(finalAnswerPath, buildFinalSummary(request, state), "utf8");
      }
    );

    return [curatedNotePath, finalAnswerPath];
  }

  private async runSubagent(
    request: ScenarioAgentRunRequest,
    state: WorkspaceExecutionState
  ): Promise<WorkspaceSubagentEvent[]> {
    if (request.scenario.driftEvaluationSpec.trajectory.criticalDelegations.length === 0) {
      return [];
    }

    const delegationName =
      request.scenario.driftEvaluationSpec.trajectory.criticalDelegations[0] ??
      "workspace-subagent";
    const taskSummary = buildSubagentTaskSummary(request.scenario, state.retrievedDocuments);
    const subagentOutputDirectory = path.join(request.environment.workspacePath, "delegations");
    const subagentOutputPath = path.join(
      subagentOutputDirectory,
      `${request.scenario.taskFamily}-subagent-output.md`
    );

    const subagentEvent = await request.trace.runInSpan(
      {
        name: delegationName,
        kind: "subagent_call",
        metadata: {
          model: this.subagentModel,
          modelTier: this.subagentModelTier
        }
      },
      async () => {
        await mkdir(subagentOutputDirectory, { recursive: true });
        await writeFile(
          subagentOutputPath,
          [
            `# ${delegationName}`,
            "",
            taskSummary,
            "",
            `result: ${request.scenario.expectedOutcomes[0]?.summary ?? request.scenario.caseBrief}`
          ].join("\n"),
          "utf8"
        );

        return {
          subagentId: `${request.runId}-${delegationName}`,
          model: this.subagentModel,
          modelTier: this.subagentModelTier,
          taskSummary,
          status: "completed" as const
        };
      }
    );

    state.outputArtifacts.push(subagentOutputPath);
    state.latencyMs += this.subagentLatencyMs;

    return [subagentEvent];
  }
}

function createWorkspaceExecutionState(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan,
  contextWindowSizeTokens: number
): WorkspaceExecutionState {
  return {
    graphPath: buildGraphPath(scenario, executionPlan),
    groundedEvidenceRefs: [
      ...new Set(
        scenario.expectedOutcomes.flatMap((expectedOutcome) => expectedOutcome.requiredEvidenceRefs)
      )
    ],
    retrievalEvents: [],
    subagentEvents: [],
    memoryCandidatesObserved: [],
    memoryReads: [],
    memoryWrites: [],
    memoryWritesSkipped: [],
    retrievedDocuments: [],
    outputArtifacts: [],
    contextMetrics: {
      contextWindowSizeTokens,
      promptTokens: 0,
      retrievedContextTokens: 0,
      relevantContextTokens: 0,
      unusedContextTokens: 0,
      workspaceArtifactTokens: 0,
      subagentCommunicationTokens: 0
    },
    latencyMs: 0
  };
}

function buildGraphPath(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): string[] {
  const graphPath = [
    ...scenario.trajectoryHints.expectedNodes,
    ...scenario.driftEvaluationSpec.trajectory.requiredSteps
  ];

  if (
    executionPlan.feedbackTurns.length > 0 &&
    !graphPath.includes("applyFeedback")
  ) {
    graphPath.splice(Math.max(graphPath.length - 1, 0), 0, "applyFeedback");
  }

  return [...new Set(graphPath)];
}

function selectRetrievalTargets(
  scenario: Scenario,
  environment: MaterializedCaseEnvironment
): Array<{ entry: ArtifactRegistryEntry; isSelected: boolean }> {
  const candidateEntries = environment.registryEntries.filter((entry) =>
    isRelevantWorkspaceInput(entry)
  );
  const selectedEntries = new Set<string>();

  for (const entry of candidateEntries) {
    if (entry.path.includes(`${path.sep}workspace-seeds${path.sep}`)) {
      selectedEntries.add(entry.entryId);
      continue;
    }

    if (entry.path.includes(`${path.sep}data-sources${path.sep}`)) {
      selectedEntries.add(entry.entryId);
      continue;
    }

    if (
      scenario.modalityProfile.some((modality) =>
        entry.title.toLowerCase().includes(modality)
      )
    ) {
      selectedEntries.add(entry.entryId);
    }
  }

  const scenarioOverviewEntry = environment.registryEntries.find((entry) =>
    entry.path.endsWith(`${path.sep}scenario-overview.json`)
  );

  if (scenarioOverviewEntry) {
    selectedEntries.add(scenarioOverviewEntry.entryId);
  }

  return candidateEntries.map((entry) => ({
    entry,
    isSelected: selectedEntries.has(entry.entryId)
  }));
}

function isRelevantWorkspaceInput(entry: ArtifactRegistryEntry): boolean {
  if (entry.sourceKind === "context_variant" || entry.sourceKind === "prompt_variant") {
    return false;
  }

  return (
    entry.sourceKind === "synthetic_pack_data_source" ||
    entry.sourceKind === "synthetic_pack_artifact" ||
    entry.sourceKind === "workspace_seed" ||
    entry.sourceKind === "scenario_data_source"
  );
}

function buildRetrievalQuery(
  scenario: Scenario,
  executionPlan: ScenarioExecutionPlan
): string {
  const feedbackFragment =
    executionPlan.feedbackTurns.length > 0 ? " with reviewer corrections" : "";
  return `${scenario.taskFamily} case evidence${feedbackFragment}`;
}

function collectRelevantArtifactRefs(
  scenario: Scenario,
  selectedEntries: Array<{ entry: ArtifactRegistryEntry; isSelected: boolean }>
): string[] {
  const requiredEvidenceRefs = new Set(
    scenario.expectedOutcomes.flatMap((expectedOutcome) => expectedOutcome.requiredEvidenceRefs)
  );

  return selectedEntries
    .filter(({ isSelected }) => isSelected)
    .map(({ entry }) => entry.sourceId)
    .filter((sourceId) => requiredEvidenceRefs.has(sourceId));
}

function buildCuratedContextLines(
  scenario: Scenario,
  retrievedDocuments: RetrievedDocument[]
): string[] {
  const lines = [
    ...scenario.contextEvaluationSpec.requiredContext.map((item) => `- required: ${item}`),
    ...retrievedDocuments.map((document) => `- retrieved: ${document.entry.title}`)
  ];

  if (scenario.taskFamily === "governance") {
    lines.push("- conclusion: third_party_risk_committee owns the annual review control");
  }

  if (scenario.taskFamily === "investigation") {
    lines.push("- conclusion: reuse the prior linked-entity summary before extending it");
  }

  return lines;
}

function buildSubagentTaskSummary(
  scenario: Scenario,
  retrievedDocuments: RetrievedDocument[]
): string {
  if (scenario.taskFamily === "investigation") {
    return "Review the linked-entity chart and return only the nominee-director delta.";
  }

  return `Validate the delegated ${scenario.taskFamily} evidence set using ${retrievedDocuments.length} curated inputs.`;
}

function applyMemoryDecisions(
  request: ScenarioAgentRunRequest,
  state: WorkspaceExecutionState
): void {
  const memorySpec = request.scenario.memoryEvaluationSpec;

  if (!memorySpec) {
    return;
  }

  state.memoryCandidatesObserved = memorySpec.memoryOpportunities.map((opportunity) => ({
    candidateId: opportunity.opportunityId,
    summary: opportunity.summary
  }));

  for (const candidate of state.memoryCandidatesObserved) {
    request.trace.recordMemoryDecision({
      type: "observed_candidate",
      candidateId: candidate.candidateId,
      summary: candidate.summary
    });
  }

  if (request.executionPlan.mode === "initial") {
    state.memoryWrites = memorySpec.memoryOpportunities
      .filter(
        (opportunity) =>
          opportunity.worthKeeping && opportunity.relatedTurnIds.includes("turn-1")
      )
      .map((opportunity) => ({
        candidateId: opportunity.opportunityId,
        summary: opportunity.summary,
        source: opportunity.source,
        scope: opportunity.scope,
        rationale: opportunity.neededLater
          ? "Persist the high-value case memory for the next turn."
          : "Persist the reusable workspace insight for future runs."
      }));

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

    return;
  }

  const checkpointsForTurn = memorySpec.memoryCheckpoints.filter(
    (checkpoint) => checkpoint.turnId === "turn-2"
  );
  const neededNowIds = new Set(
    checkpointsForTurn.flatMap((checkpoint) => checkpoint.relatedOpportunityIds)
  );
  const checkpointByOpportunityId = new Map(
    checkpointsForTurn.flatMap((checkpoint) =>
      checkpoint.relatedOpportunityIds.map((opportunityId) => [opportunityId, checkpoint])
    )
  );
  state.memoryWrites = memorySpec.memoryOpportunities
    .filter(
      (opportunity) =>
        opportunity.worthKeeping && opportunity.relatedTurnIds.includes("turn-2")
    )
    .map((opportunity) => ({
      candidateId: opportunity.opportunityId,
      summary: opportunity.summary,
      source: opportunity.source,
      scope: opportunity.scope,
      rationale: "Persist the feedback-informed memory before composing the rerun."
    }));
  state.memoryWritesSkipped = memorySpec.memoryOpportunities
    .filter(
      (opportunity) =>
        !opportunity.worthKeeping && opportunity.relatedTurnIds.includes("turn-2")
    )
    .map((opportunity) => ({
      candidateId: opportunity.opportunityId,
      summary: opportunity.summary,
      source: opportunity.source,
      scope: opportunity.scope,
      rationale: "Skipped because the rerun marks this memory as low value."
    }));

  state.memoryReads = memorySpec.memoryOpportunities
    .filter((opportunity) => neededNowIds.has(opportunity.opportunityId))
    .map((opportunity) => ({
      candidateId: opportunity.opportunityId,
      summary: opportunity.summary,
      source: opportunity.source,
      scope: opportunity.scope,
      neededNow: opportunity.neededLater,
      usedInDecision: opportunity.neededLater,
      impact: opportunity.neededLater ? memorySpec.expectedMemoryImpact : "neutral"
    }));

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
    const checkpoint = checkpointByOpportunityId.get(memoryRead.candidateId);
    request.trace.recordMemoryDecision({
      type: memoryRead.usedInDecision ? "used_in_decision" : "retrieved",
      candidateId: memoryRead.candidateId,
      summary: memoryRead.summary,
      source: memoryRead.source,
      scope: memoryRead.scope,
      rationale: checkpoint?.rationale ?? "Retrieved for the feedback-informed rerun."
    });
  }
}

async function buildContextMetrics(
  request: ScenarioAgentRunRequest,
  state: WorkspaceExecutionState,
  contextWindowSizeTokens: number
): Promise<WorkspaceContextMetrics> {
  const retrievedContextTokens = state.retrievalEvents.reduce(
    (total, event) => total + event.retrievedTokenCount,
    0
  );
  const workspaceArtifactTokens = (
    await Promise.all(
      state.outputArtifacts.map(async (artifactPath) =>
        estimateTextTokens(await readFile(artifactPath, "utf8"))
      )
    )
  ).reduce((total, tokenCount) => total + tokenCount, 0);

  return {
    contextWindowSizeTokens,
    promptTokens:
      request.scenario.contextEvaluationSpec.systemPromptProfile.fixedTokenOverhead +
      request.scenario.contextEvaluationSpec.systemPromptProfile.dynamicTokenOverhead +
      request.scenario.contextEvaluationSpec.toolSurfaceProfile.toolDefinitionTokenOverhead,
    retrievedContextTokens,
    relevantContextTokens: state.retrievalEvents.reduce(
      (total, event) => total + event.relevantTokenCount,
      0
    ),
    unusedContextTokens: Math.max(
      retrievedContextTokens -
        state.retrievalEvents.reduce((total, event) => total + event.relevantTokenCount, 0),
      0
    ),
    workspaceArtifactTokens,
    subagentCommunicationTokens: state.subagentEvents.length * 24
  };
}

function buildFinalSummary(
  request: ScenarioAgentRunRequest,
  state: WorkspaceExecutionState
): string {
  const coreOutcome =
    request.scenario.expectedOutcomes[0]?.summary ?? request.scenario.caseBrief;
  const feedbackClause =
    request.executionPlan.feedbackTurns.length > 0
      ? ` Feedback applied from ${request.executionPlan.feedbackTurns
          .map((feedbackTurn) => feedbackTurn.feedbackId)
          .join(", ")}.`
      : "";

  return `${coreOutcome} Curated ${state.retrievalEvents[0]?.selectedCount ?? 0} inputs, delegated ${state.subagentEvents.length} subtask.${feedbackClause}`;
}

function calculateTokenUsage(
  request: ScenarioAgentRunRequest,
  state: WorkspaceExecutionState
) {
  const inputTokens =
    state.contextMetrics.promptTokens + state.contextMetrics.retrievedContextTokens;
  const outputTokens =
    Math.max(Math.ceil(buildFinalSummary(request, state).length / 4), 1) +
    state.contextMetrics.subagentCommunicationTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  };
}

function estimateTextTokens(value: string): number {
  return Math.max(Math.ceil(value.length / 4), 1);
}

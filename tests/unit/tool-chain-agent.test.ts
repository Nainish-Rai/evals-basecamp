import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createToolChainInitialState,
  createToolChainScenarioAgent
} from "../../src/agents/tool-chain/create-tool-chain-agent.js";
import {
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../src/domain/scenarios/scenario-loader.js";
import { CaseEnvironmentMaterializer } from "../../src/runtime/materialization/case-environment-materializer.js";
import {
  FeedbackReplayEngine,
  type ScenarioExecutionPlan
} from "../../src/runtime/runner/feedback-replay-engine.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("tool-chain agent", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("creates an empty initial state with structured ledgers", () => {
    expect(createToolChainInitialState()).toEqual({
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
    });
  });

  it("records tool specs, multimodal normalization, and budget data on an initial run", async () => {
    const runtimeFixture = await loadRuntimeFixture("compliance-001.json");
    const agent = createToolChainScenarioAgent();

    const result = await agent.run({
      scenario: runtimeFixture.scenario,
      environment: runtimeFixture.environment,
      executionPlan: getExecutionPlan(runtimeFixture.executionPlans, 0),
      trace: createTraceStub()
    });
    const metadata = getToolChainMetadata(result.metadata);

    expect(result.summary).toContain("Disposition: hold_for_document_collection.");
    expect(metadata).toMatchObject({
      graphPath: ["planToolWork", "executeTool", "applyFeedback", "composeFinalAnswer"],
      groundedEvidenceRefs: ["artifact-compliance-001-policy"]
    });
    expect(metadata.toolSpecsCreated).toHaveLength(2);
    expect(metadata.toolCreationEvents).toHaveLength(2);
    expect(metadata.toolCalls).toHaveLength(2);
    expect(metadata.budgetLedger).toEqual([
      {
        budgetName: "tool_calls",
        scope: "run",
        allocated: 2,
        consumed: 2,
        remaining: 0,
        unit: "tools",
        withinBudget: true
      }
    ]);
    expect(metadata.multimodalNormalizationEvents).toEqual([
      expect.objectContaining({
        modality: "pdf",
        strategy: "structured_summary"
      })
    ]);
    expect(metadata.stateSnapshot.feedbackLedger).toEqual([]);
  });

  it("records failed and skipped tool calls when ambiguity and budget pressure exist", async () => {
    const runtimeFixture = await loadRuntimeFixture("risk-002.json");
    const agent = createToolChainScenarioAgent({ toolCallBudget: 2 });

    const result = await agent.run({
      scenario: runtimeFixture.scenario,
      environment: runtimeFixture.environment,
      executionPlan: getExecutionPlan(runtimeFixture.executionPlans, 0),
      trace: createTraceStub()
    });
    const metadata = getToolChainMetadata(result.metadata);

    expect(metadata.toolCalls).toHaveLength(3);
    expect(metadata.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "glossary_search",
          status: "failed",
          outputSummary: "Ambiguous tool framing caused a retry without introducing new facts."
        }),
        expect.objectContaining({
          toolName: "policy_search",
          status: "skipped",
          outputSummary: "Skipped because the tool-call budget was exhausted."
        })
      ])
    );
    expect(metadata.budgetLedger).toEqual([
      {
        budgetName: "tool_calls",
        scope: "run",
        allocated: 2,
        consumed: 2,
        remaining: 0,
        unit: "tools",
        withinBudget: true
      }
    ]);
    expect(result.summary).toContain("Ambiguous tool framing caused a retry");
  });

  it("integrates feedback and memory behavior on the rerun path", async () => {
    const runtimeFixture = await loadRuntimeFixture("compliance-001.json");
    const agent = createToolChainScenarioAgent();

    const result = await agent.run({
      scenario: runtimeFixture.scenario,
      environment: runtimeFixture.environment,
      executionPlan: getExecutionPlan(runtimeFixture.executionPlans, 1),
      trace: createTraceStub()
    });
    const metadata = getToolChainMetadata(result.metadata);

    expect(metadata.stateSnapshot.feedbackLedger).toEqual([
      {
        feedbackId: "feedback-compliance-001",
        summary: "The first draft missed the proof-of-address requirement.",
        instructionCount: 2,
        correctedFactCount: 1
      }
    ]);
    expect(metadata.memoryWrites).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-compliance-001",
        source: "user",
        scope: "case"
      })
    ]);
    expect(metadata.memoryReads).toEqual([
      expect.objectContaining({
        candidateId: "memory-opportunity-compliance-001",
        neededNow: true,
        usedInDecision: true,
        impact: "positive"
      })
    ]);
    expect(metadata.stateSnapshot.toolCalls.length).toBeGreaterThan(0);
    expect(result.summary).toContain("The first draft missed the proof-of-address requirement.");
  });
});

async function loadRuntimeFixture(scenarioFileName: string) {
  const outputRootPath = await mkdtemp(path.join(tmpdir(), "evals-basecamp-tool-chain-"));
  cleanupPaths.push(outputRootPath);

  const [scenario, syntheticPacks] = await Promise.all([
    loadScenarioFile(path.join(fixtureRoot, "scenarios", scenarioFileName)),
    loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"))
  ]);
  const environment = await new CaseEnvironmentMaterializer().materialize({
    scenario,
    syntheticPacksById: new Map(
      syntheticPacks.map((syntheticPack) => [syntheticPack.packId, syntheticPack])
    ),
    outputRootPath
  });

  return {
    scenario,
    environment,
    executionPlans: new FeedbackReplayEngine().planExecutions(scenario)
  };
}

function createTraceStub() {
  return {
    runInSpan: async <T>(_options: unknown, operation: () => Promise<T>) => operation(),
    recordScore: () => {},
    recordMemoryDecision: () => {},
    recordEvent: () => {},
    attachVendorTraceId: () => {},
    annotate: () => {},
    snapshot: () => ({
      traceId: null,
      enabled: false,
      traceName: null,
      status: "completed" as const,
      startedAt: null,
      endedAt: null,
      spanCount: 0,
      scoreCount: 0,
      eventCount: 0,
      vendorTraceIds: []
    }),
    finish: () => ({
      traceId: null,
      enabled: false,
      traceName: null,
      status: "completed" as const,
      startedAt: null,
      endedAt: null,
      spanCount: 0,
      scoreCount: 0,
      eventCount: 0,
      vendorTraceIds: []
    }),
    export: () => null
  };
}

function getExecutionPlan(
  executionPlans: ScenarioExecutionPlan[],
  index: number
): ScenarioExecutionPlan {
  const executionPlan = executionPlans[index];

  if (!executionPlan) {
    throw new Error(`Missing execution plan at index ${index}`);
  }

  return executionPlan;
}

function getToolChainMetadata(metadata: unknown) {
  return metadata as {
    graphPath: string[];
    groundedEvidenceRefs: string[];
    toolSpecsCreated: unknown[];
    toolCreationEvents: unknown[];
    toolCalls: Array<Record<string, unknown>>;
    budgetLedger: unknown[];
    multimodalNormalizationEvents: unknown[];
    memoryWrites: unknown[];
    memoryReads: unknown[];
    stateSnapshot: {
      feedbackLedger: unknown[];
      toolCalls: unknown[];
    };
  };
}

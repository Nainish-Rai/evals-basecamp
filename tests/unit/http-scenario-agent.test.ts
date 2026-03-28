import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadScenarioFile, loadSyntheticPackDirectory } from "../../src/domain/scenarios/scenario-loader.js";
import { CaseEnvironmentMaterializer } from "../../src/runtime/materialization/case-environment-materializer.js";
import { FeedbackReplayEngine } from "../../src/runtime/runner/feedback-replay-engine.js";
import {
  HttpScenarioAgent,
  HttpScenarioAgentResponseError,
  HttpScenarioAgentResponseValidationError
} from "../../src/runtime/runner/http-scenario-agent.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");
const cleanupPaths: string[] = [];

describe("HttpScenarioAgent", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0)
        .map((cleanupPath) => rm(cleanupPath, { recursive: true, force: true }))
    );
  });

  it("posts the materialized scenario payload to the external endpoint", async () => {
    const { scenario, environment, executionPlan } = await loadRuntimeFixture();
    const fetchImplementation = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body;

        if (typeof body !== "string") {
          throw new Error("Expected a JSON string request body");
        }

        const requestBody = JSON.parse(body) as {
          scenario: { scenarioId: string };
          execution: { mode: string };
          environment: {
            artifactSnapshots: Array<{ relativePath: string; content: string }>;
          };
        };

        expect(init?.method).toBe("POST");
        expect(requestBody.scenario.scenarioId).toBe(scenario.scenarioId);
        expect(requestBody.execution.mode).toBe(executionPlan.mode);
        expect(requestBody.environment.artifactSnapshots.length).toBeGreaterThan(0);
        expect(
          requestBody.environment.artifactSnapshots[0]?.relativePath.length
        ).toBeGreaterThan(0);
        expect(requestBody.environment.artifactSnapshots[0]?.content.length).toBeGreaterThan(
          0
        );

        return Promise.resolve(
          new Response(
            JSON.stringify({
              summary: "completed by external vendor",
              outputArtifacts: ["reports/final.md"],
              tokenUsage: {
                inputTokens: 410,
                outputTokens: 90,
                totalTokens: 500
              },
              metadata: {
                provider: "vendor",
                graphPath: ["planToolWork", "executeTool", "composeFinalAnswer"],
                toolSpecsCreated: [
                  {
                    toolName: "policy_search",
                    description: "Searches policy context",
                    inputSchemaSummary: "query: string",
                    reusedExistingTool: true
                  }
                ],
                toolCalls: [
                  {
                    callId: "tool-call-1",
                    toolName: "policy_search",
                    status: "succeeded",
                    latencyMs: 14,
                    inputSummary: "query=proof of address",
                    outputSummary: "Returned the relevant policy section.",
                    consumedBudget: 1,
                    contextTokensUsed: 120,
                    inputArtifactRefs: ["artifact-policy-kyc"],
                    outputArtifactRefs: ["artifact-policy-kyc"]
                  }
                ],
                budgetLedger: [
                  {
                    budgetName: "tool_calls",
                    scope: "run",
                    allocated: 3,
                    consumed: 1,
                    remaining: 2,
                    unit: "tools",
                    withinBudget: true
                  }
                ]
              },
              vendorTraceId: "vendor-trace-001"
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        );
      }
    );
    const agent = new HttpScenarioAgent({
      endpoint: "https://vendor.example.com/evals/run",
      apiKey: "secret-token",
      fetchImplementation
    });

    const result = await agent.run({
      scenario,
      environment,
      executionPlan,
      trace: createEnabledTrace()
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(result.summary).toContain("external vendor");
    expect(result.outputArtifacts).toEqual(["reports/final.md"]);
    expect(result.metadata).toMatchObject({
      provider: "vendor",
      graphPath: ["planToolWork", "executeTool", "composeFinalAnswer"],
      toolSpecsCreated: [
        expect.objectContaining({
          toolName: "policy_search"
        })
      ],
      budgetLedger: [
        expect.objectContaining({
          budgetName: "tool_calls",
          remaining: 2
        })
      ]
    });
    expect(result.vendorTraceId).toBe("vendor-trace-001");
  });

  it("fails on non-success responses from the external endpoint", async () => {
    const { scenario, environment, executionPlan } = await loadRuntimeFixture();
    const agent = new HttpScenarioAgent({
      endpoint: "https://vendor.example.com/evals/run",
      fetchImplementation: vi.fn(() =>
        Promise.resolve(new Response("upstream down", { status: 502 }))
      )
    });

    await expect(
      agent.run({
        scenario,
        environment,
        executionPlan,
        trace: createDisabledTrace()
      })
    ).rejects.toBeInstanceOf(HttpScenarioAgentResponseError);
  });

  it("fails when the external endpoint returns an invalid payload", async () => {
    const { scenario, environment, executionPlan } = await loadRuntimeFixture();
    const agent = new HttpScenarioAgent({
      endpoint: "https://vendor.example.com/evals/run",
      fetchImplementation: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ summary: "missing token usage" }), {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          })
        )
      )
    });

    await expect(
      agent.run({
        scenario,
        environment,
        executionPlan,
        trace: createDisabledTrace()
      })
    ).rejects.toBeInstanceOf(HttpScenarioAgentResponseValidationError);
  });
});

async function loadRuntimeFixture() {
  const outputRootPath = await mkdtemp(path.join(tmpdir(), "evals-basecamp-http-agent-"));
  cleanupPaths.push(outputRootPath);

  const [scenario, syntheticPacks] = await Promise.all([
    loadScenarioFile(path.join(fixtureRoot, "scenarios", "risk-001.json")),
    loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"))
  ]);
  const environment = await new CaseEnvironmentMaterializer().materialize({
    scenario,
    syntheticPacksById: new Map(
      syntheticPacks.map((syntheticPack) => [syntheticPack.packId, syntheticPack])
    ),
    outputRootPath
  });
  const executionPlan = new FeedbackReplayEngine().planExecutions(scenario)[0];

  if (!executionPlan) {
    throw new Error("Expected an execution plan for the fixture scenario");
  }

  return {
    scenario,
    environment,
    executionPlan
  };
}

function createEnabledTrace() {
  return {
    runInSpan: async <T>(_options: unknown, operation: () => Promise<T>) => operation(),
    recordScore: () => {},
    recordMemoryDecision: () => {},
    recordEvent: () => {},
    attachVendorTraceId: () => {},
    annotate: () => {},
    snapshot: () => ({
      traceId: "trace-123",
      enabled: true,
      traceName: "scenario_run",
      status: "completed" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      spanCount: 0,
      scoreCount: 0,
      eventCount: 0,
      vendorTraceIds: []
    }),
    finish: () => ({
      traceId: "trace-123",
      enabled: true,
      traceName: "scenario_run",
      status: "completed" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      spanCount: 0,
      scoreCount: 0,
      eventCount: 0,
      vendorTraceIds: []
    }),
    export: () => ({
      traceId: "trace-123",
      enabled: true,
      traceName: "scenario_run",
      status: "completed" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      metadata: {},
      scores: [],
      spans: [],
      events: [],
      vendorTraceIds: []
    })
  };
}

function createDisabledTrace() {
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

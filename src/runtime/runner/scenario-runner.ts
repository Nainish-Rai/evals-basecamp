import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { SyntheticPack } from "../../domain/scenarios/synthetic-pack-schema.js";
import {
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../domain/scenarios/scenario-loader.js";
import {
  LangfuseTracer,
  type BenchmarkTrace,
  type TraceExport
} from "../tracing/langfuse-tracer.js";
import {
  CaseEnvironmentMaterializer,
  type MaterializedCaseEnvironment
} from "../materialization/case-environment-materializer.js";
import {
  FeedbackReplayEngine,
  type ScenarioExecutionMode,
  type ScenarioExecutionPlan
} from "./feedback-replay-engine.js";
import {
  StubScenarioAgent,
  type ScenarioAgent,
  type ScenarioAgentRunResult
} from "./stub-scenario-agent.js";
import type { LangfuseTraceContext } from "../tracing/langfuse-tracer.js";
import { createWorkspaceScenarioAgent } from "../../agents/workspace/create-workspace-agent.js";

export type ScenarioRunRequest = {
  scenario: Scenario;
  syntheticPacks: SyntheticPack[];
  outputRootPath?: string;
  agent?: ScenarioAgent;
};

export type ScenarioRunFromFileSystemRequest = {
  scenarioFilePath: string;
  syntheticPackDirectoryPath: string;
  outputRootPath?: string;
  agent?: ScenarioAgent;
};

export type ScenarioExecutionResult = {
  runId: string;
  mode: ScenarioExecutionMode;
  feedbackIds: string[];
  agentResult: ScenarioAgentRunResult;
};

export type ScenarioRunResult = {
  scenarioId: string;
  scenario: Scenario;
  environment: MaterializedCaseEnvironment;
  executions: ScenarioExecutionResult[];
  traceContext: LangfuseTraceContext;
  traceExport: TraceExport | null;
};

export class ScenarioRunner {
  constructor(
    private readonly materializer = new CaseEnvironmentMaterializer(),
    private readonly feedbackReplayEngine = new FeedbackReplayEngine(),
    private readonly tracer = new LangfuseTracer()
  ) {}

  async run(request: ScenarioRunRequest): Promise<ScenarioRunResult> {
    const agent = request.agent ?? createDefaultAgent(request.scenario);
    const trace = this.tracer.startTrace({
      name: "scenario_run",
      metadata: {
        scenarioId: request.scenario.scenarioId,
        taskFamily: request.scenario.taskFamily,
        agentFamily: request.scenario.agentFamily
      }
    });

    try {
      const syntheticPacksById = new Map(
        request.syntheticPacks.map((syntheticPack) => [
          syntheticPack.packId,
          syntheticPack
        ])
      );
      const materializerRequest = {
        scenario: request.scenario,
        syntheticPacksById
      } satisfies Omit<
        Parameters<CaseEnvironmentMaterializer["materialize"]>[0],
        "outputRootPath"
      >;
      const environment = await trace.runInSpan(
        {
          name: "materialize_case_environment",
          kind: "workspace_write",
          metadata: {
            outputRootPath: request.outputRootPath ?? null
          }
        },
        async () =>
          this.materializer.materialize(
            request.outputRootPath
              ? {
                  ...materializerRequest,
                  outputRootPath: request.outputRootPath
                }
              : materializerRequest
          )
      );
      const executionPlans = this.feedbackReplayEngine.planExecutions(request.scenario);
      const executions = await this.executeScenarioPlans(
        request.scenario,
        environment,
        executionPlans,
        agent,
        trace
      );

      trace.recordScore({
        name: "execution_count",
        value: executions.length,
        comment: "Number of scenario executions, including feedback reruns."
      });
      trace.annotate({
        workspacePath: environment.workspacePath,
        registryEntryCount: environment.registryEntries.length
      });

      return {
        scenarioId: request.scenario.scenarioId,
        scenario: request.scenario,
        environment,
        executions,
        traceContext: trace.finish(),
        traceExport: trace.export()
      };
    } catch (error) {
      trace.recordEvent("scenario_run_failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  async runFromFileSystem(
    request: ScenarioRunFromFileSystemRequest
  ): Promise<ScenarioRunResult> {
    const [scenario, syntheticPacks] = await Promise.all([
      loadScenarioFile(request.scenarioFilePath),
      loadSyntheticPackDirectory(request.syntheticPackDirectoryPath)
    ]);

    const runRequest = {
      scenario,
      syntheticPacks
    } satisfies Omit<ScenarioRunRequest, "outputRootPath" | "agent">;

    return this.run(
      request.outputRootPath || request.agent
        ? {
            ...runRequest,
            ...(request.outputRootPath
              ? { outputRootPath: request.outputRootPath }
              : {}),
            ...(request.agent ? { agent: request.agent } : {})
          }
        : runRequest
    );
  }

  private async executeScenarioPlans(
    scenario: Scenario,
    environment: MaterializedCaseEnvironment,
    executionPlans: ScenarioExecutionPlan[],
    agent: ScenarioAgent,
    trace: BenchmarkTrace
  ): Promise<ScenarioExecutionResult[]> {
    const executions: ScenarioExecutionResult[] = [];
    const runSeed =
      trace.snapshot().traceId ??
      `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    for (const [executionIndex, executionPlan] of executionPlans.entries()) {
      const runId = buildRunId({
        scenarioId: scenario.scenarioId,
        runSeed,
        mode: executionPlan.mode,
        feedbackIds: executionPlan.feedbackTurns.map((feedbackTurn) => feedbackTurn.feedbackId),
        executionIndex
      });
      const agentResult = await trace.runInSpan(
        {
          name: `execution.${executionPlan.mode}`,
          kind: "runner",
          metadata: {
            feedbackCount: executionPlan.feedbackTurns.length,
            runId
          }
        },
        () =>
          agent.run({
            runId,
            scenario,
            environment,
            executionPlan,
            trace
          })
      );

      if (agentResult.vendorTraceId) {
        trace.attachVendorTraceId(agentResult.vendorTraceId);
      }

      executions.push({
        runId,
        mode: executionPlan.mode,
        feedbackIds: executionPlan.feedbackTurns.map(
          (feedbackTurn) => feedbackTurn.feedbackId
        ),
        agentResult
      });
    }

    return executions;
  }
}

function createDefaultAgent(scenario: Scenario): ScenarioAgent {
  if (scenario.agentFamily === "workspace") {
    return createWorkspaceScenarioAgent();
  }

  return new StubScenarioAgent();
}

function buildRunId(options: {
  scenarioId: string;
  runSeed: string;
  mode: ScenarioExecutionMode;
  feedbackIds: string[];
  executionIndex: number;
}): string {
  const feedbackPart =
    options.feedbackIds.length > 0 ? options.feedbackIds.join("-") : "no-feedback";

  return [
    options.scenarioId,
    options.runSeed,
    options.mode,
    feedbackPart,
    `attempt-${options.executionIndex + 1}`
  ]
    .map((part) => sanitizeRunIdPart(part))
    .join("__");
}

function sanitizeRunIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

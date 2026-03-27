import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { SyntheticPack } from "../../domain/scenarios/synthetic-pack-schema.js";
import {
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../domain/scenarios/scenario-loader.js";
import { LangfuseTracer } from "../tracing/langfuse-tracer.js";
import {
  CaseEnvironmentMaterializer,
  type MaterializedCaseEnvironment
} from "../materialization/case-environment-materializer.js";
import {
  FeedbackReplayEngine,
  type ScenarioExecutionMode
} from "./feedback-replay-engine.js";
import {
  StubScenarioAgent,
  type ScenarioAgent,
  type ScenarioAgentRunResult
} from "./stub-scenario-agent.js";

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
  mode: ScenarioExecutionMode;
  feedbackIds: string[];
  agentResult: ScenarioAgentRunResult;
};

export type ScenarioRunResult = {
  scenarioId: string;
  environment: MaterializedCaseEnvironment;
  executions: ScenarioExecutionResult[];
  traceContext: ReturnType<LangfuseTracer["createTraceContext"]>;
};

export class ScenarioRunner {
  constructor(
    private readonly materializer = new CaseEnvironmentMaterializer(),
    private readonly feedbackReplayEngine = new FeedbackReplayEngine(),
    private readonly tracer = new LangfuseTracer()
  ) {}

  async run(request: ScenarioRunRequest): Promise<ScenarioRunResult> {
    const agent = request.agent ?? new StubScenarioAgent();
    const syntheticPacksById = new Map(
      request.syntheticPacks.map((syntheticPack) => [syntheticPack.packId, syntheticPack])
    );
    const materializerRequest = {
      scenario: request.scenario,
      syntheticPacksById
    } satisfies Omit<
      Parameters<CaseEnvironmentMaterializer["materialize"]>[0],
      "outputRootPath"
    >;
    const environment = await this.materializer.materialize(
      request.outputRootPath
        ? {
            ...materializerRequest,
            outputRootPath: request.outputRootPath
          }
        : materializerRequest
    );
    const executionPlans = this.feedbackReplayEngine.planExecutions(request.scenario);
    const executions: ScenarioExecutionResult[] = [];

    for (const executionPlan of executionPlans) {
      const agentResult = await agent.run({
        environment,
        executionPlan
      });

      executions.push({
        mode: executionPlan.mode,
        feedbackIds: executionPlan.feedbackTurns.map((feedbackTurn) => feedbackTurn.feedbackId),
        agentResult
      });
    }

    return {
      scenarioId: request.scenario.scenarioId,
      environment,
      executions,
      traceContext: this.tracer.createTraceContext()
    };
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
}

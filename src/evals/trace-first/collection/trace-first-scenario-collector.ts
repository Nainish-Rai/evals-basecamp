import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Scenario } from "../../../domain/scenarios/scenario-schema.js";
import {
  loadScenarioDirectory,
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../../domain/scenarios/scenario-loader.js";
import { loadEnvironmentConfig } from "../../../infra/config/env.js";
import { ScenarioRunner } from "../../../runtime/runner/scenario-runner.js";
import { HttpScenarioAgent } from "../../../runtime/runner/http-scenario-agent.js";
import type { ScenarioAgent } from "../../../runtime/runner/stub-scenario-agent.js";
import { LangfuseTracer } from "../../../runtime/tracing/langfuse-tracer.js";
import { ScenarioRunBundleAdapter } from "../adapters/scenario-run-bundle-adapter.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import {
  LangfuseTraceFetcher,
  type TraceFirstTraceFetcher
} from "./langfuse-trace-fetcher.js";

export type TraceFirstCollectorRequest =
  | {
      scenarioFilePath: string;
      syntheticPackDirectoryPath: string;
      outputDirectoryPath: string;
    }
  | {
      scenarioDirectoryPath: string;
      syntheticPackDirectoryPath: string;
      outputDirectoryPath: string;
    };

export class TraceFirstScenarioCollector {
  constructor(
    private readonly adapter = new ScenarioRunBundleAdapter(),
    private readonly agentFactory?: (scenario: Scenario) => ScenarioAgent,
    private readonly traceFetcher?: TraceFirstTraceFetcher,
    private readonly tracerEnabled?: boolean
  ) {}

  async collect(request: TraceFirstCollectorRequest): Promise<RunBundle[]> {
    const syntheticPacks = await loadSyntheticPackDirectory(request.syntheticPackDirectoryPath);
    const scenarios = "scenarioFilePath" in request
      ? [await loadScenarioFile(request.scenarioFilePath)]
      : await loadScenarioDirectory(request.scenarioDirectoryPath);
    const bundles: RunBundle[] = [];
    const runBundlesDirectoryPath = path.join(request.outputDirectoryPath, "run-bundles");
    const environmentConfig = loadEnvironmentConfig();

    await mkdir(runBundlesDirectoryPath, { recursive: true });

    for (const scenario of scenarios) {
      const scenarioOutputPath = path.join(
        request.outputDirectoryPath,
        "collector-workspaces",
        scenario.scenarioId
      );
      const runResult = await new ScenarioRunner(
        undefined,
        undefined,
        new LangfuseTracer({
          enabled:
            this.tracerEnabled ??
            (this.agentFactory ? true : environmentConfig.LANGFUSE_ENABLED)
        })
      ).run({
        scenario,
        syntheticPacks,
        outputRootPath: scenarioOutputPath,
        agent: this.resolveAgentFactory(environmentConfig)(scenario)
      });
      const scenarioBundles = this.adapter.adapt(runResult);

      for (const bundle of scenarioBundles) {
        const bundlePath = path.join(runBundlesDirectoryPath, `${bundle.bundleId}.json`);
        await writeFile(bundlePath, JSON.stringify(bundle, null, 2));
      }

      bundles.push(...scenarioBundles);
    }

    return bundles;
  }

  async loadBundles(bundleDirectoryPath: string): Promise<RunBundle[]> {
    const runBundleDirectoryPath = path.join(bundleDirectoryPath, "run-bundles");
    const fileNames = (await readdir(runBundleDirectoryPath))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();

    return Promise.all(
      fileNames.map(async (fileName) => {
        const filePath = path.join(runBundleDirectoryPath, fileName);
        const fileContents = await importRunBundle(filePath);

        if (fileContents.trace !== null) {
          return fileContents;
        }

        const hydratedTrace = await this.resolveTraceFetcher().fetchTraceByRunId(
          fileContents.runId
        );

        return {
          ...fileContents,
          traceId: fileContents.traceId ?? hydratedTrace.traceId,
          trace: hydratedTrace
        };
      })
    );
  }

  private resolveAgentFactory(
    environmentConfig: ReturnType<typeof loadEnvironmentConfig>
  ): (scenario: Scenario) => ScenarioAgent {
    if (this.agentFactory) {
      return this.agentFactory;
    }

    if (!environmentConfig.EXTERNAL_AGENT_ENDPOINT) {
      throw new Error(
        "EXTERNAL_AGENT_ENDPOINT is required when collecting trace-first bundles without an injected agentFactory"
      );
    }

    return () =>
      new HttpScenarioAgent({
        endpoint: environmentConfig.EXTERNAL_AGENT_ENDPOINT!,
        ...(environmentConfig.EXTERNAL_AGENT_API_KEY
          ? {
              apiKey: environmentConfig.EXTERNAL_AGENT_API_KEY
            }
          : {}),
        timeoutMs: environmentConfig.EXTERNAL_AGENT_TIMEOUT_MS
      });
  }

  private resolveTraceFetcher(): TraceFirstTraceFetcher {
    return this.traceFetcher ?? LangfuseTraceFetcher.fromEnvironment();
  }
}

async function importRunBundle(filePath: string) {
  const { readFile } = await import("node:fs/promises");
  const { runBundleSchema } = await import("../contracts/run-bundle-schema.js");

  return runBundleSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

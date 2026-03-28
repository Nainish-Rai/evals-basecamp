import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createToolChainScenarioAgent } from "../../../agents/tool-chain/create-tool-chain-agent.js";
import {
  loadScenarioDirectory,
  loadScenarioFile,
  loadSyntheticPackDirectory
} from "../../../domain/scenarios/scenario-loader.js";
import { ScenarioRunner } from "../../../runtime/runner/scenario-runner.js";
import { StubScenarioAgent } from "../../../runtime/runner/stub-scenario-agent.js";
import { LangfuseTracer } from "../../../runtime/tracing/langfuse-tracer.js";
import { ScenarioRunBundleAdapter } from "../adapters/scenario-run-bundle-adapter.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";

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
    private readonly adapter = new ScenarioRunBundleAdapter()
  ) {}

  async collect(request: TraceFirstCollectorRequest): Promise<RunBundle[]> {
    const syntheticPacks = await loadSyntheticPackDirectory(request.syntheticPackDirectoryPath);
    const scenarios = "scenarioFilePath" in request
      ? [await loadScenarioFile(request.scenarioFilePath)]
      : await loadScenarioDirectory(request.scenarioDirectoryPath);
    const bundles: RunBundle[] = [];
    const runBundlesDirectoryPath = path.join(request.outputDirectoryPath, "run-bundles");

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
        new LangfuseTracer({ enabled: true })
      ).run({
        scenario,
        syntheticPacks,
        outputRootPath: scenarioOutputPath,
        agent:
          scenario.agentFamily === "tool_chain"
            ? createToolChainScenarioAgent()
            : new StubScenarioAgent()
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

        return fileContents;
      })
    );
  }
}

async function importRunBundle(filePath: string) {
  const { readFile } = await import("node:fs/promises");
  const { runBundleSchema } = await import("../contracts/run-bundle-schema.js");

  return runBundleSchema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

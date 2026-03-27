import path from "node:path";

import { loadEnvironmentConfig } from "../../infra/config/env.js";
import { HttpScenarioAgent } from "./http-scenario-agent.js";
import { ScenarioRunner } from "./scenario-runner.js";
import { LangfuseTracer } from "../tracing/langfuse-tracer.js";

async function main(): Promise<void> {
  const environmentConfig = loadEnvironmentConfig();
  const rawArguments = process.argv.slice(2);
  const argumentsMap = parseArguments(
    rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments
  );
  const scenarioFilePath = argumentsMap.get("--scenario");
  const syntheticPackDirectoryPath = argumentsMap.get("--packs");
  const outputRootPath = argumentsMap.get("--output");

  if (!scenarioFilePath || !syntheticPackDirectoryPath) {
    throw new Error(
      "Usage: node dist/src/runtime/runner/run-scenario-cli.js --scenario <file> --packs <dir> [--output <dir>]"
    );
  }

  const scenarioRunner = new ScenarioRunner(
    undefined,
    undefined,
    new LangfuseTracer({ enabled: environmentConfig.LANGFUSE_ENABLED })
  );
  const runRequest = {
    scenarioFilePath: path.resolve(process.cwd(), scenarioFilePath),
    syntheticPackDirectoryPath: path.resolve(
      process.cwd(),
      syntheticPackDirectoryPath
    )
  } satisfies {
    scenarioFilePath: string;
    syntheticPackDirectoryPath: string;
  };
  const result = await scenarioRunner.runFromFileSystem(
    {
      ...runRequest,
      ...(outputRootPath
        ? {
            outputRootPath: path.resolve(process.cwd(), outputRootPath)
          }
        : {}),
      ...(environmentConfig.EXTERNAL_AGENT_ENDPOINT
        ? {
            agent: new HttpScenarioAgent({
              endpoint: environmentConfig.EXTERNAL_AGENT_ENDPOINT,
              ...(environmentConfig.EXTERNAL_AGENT_API_KEY
                ? {
                    apiKey: environmentConfig.EXTERNAL_AGENT_API_KEY
                  }
                : {}),
              timeoutMs: environmentConfig.EXTERNAL_AGENT_TIMEOUT_MS
            })
          }
        : {})
    }
  );

  console.log(
    JSON.stringify(
      {
        scenarioId: result.scenarioId,
        rootPath: result.environment.rootPath,
        workspacePath: result.environment.workspacePath,
        executionModes: result.executions.map((execution) => execution.mode),
        feedbackIdsByExecution: result.executions.map(
          (execution) => execution.feedbackIds
        ),
        registryEntryCount: result.environment.registryEntries.length,
        traceContext: result.traceContext
      },
      null,
      2
    )
  );
}

function parseArguments(argumentsList: string[]): Map<string, string> {
  const filteredArguments = argumentsList.filter((argument) => argument !== "--");
  const argumentsMap = new Map<string, string>();

  for (let index = 0; index < filteredArguments.length; index += 2) {
    const key = filteredArguments[index];
    const value = filteredArguments[index + 1];

    if (!key || !value) {
      continue;
    }

    argumentsMap.set(key, value);
  }

  return argumentsMap;
}

await main();

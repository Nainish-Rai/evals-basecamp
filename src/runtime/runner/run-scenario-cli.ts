import path from "node:path";

import { ScenarioRunner } from "./scenario-runner.js";

async function main(): Promise<void> {
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

  const scenarioRunner = new ScenarioRunner();
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
    outputRootPath
      ? {
          ...runRequest,
          outputRootPath: path.resolve(process.cwd(), outputRootPath)
        }
      : runRequest
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
        registryEntryCount: result.environment.registryEntries.length
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

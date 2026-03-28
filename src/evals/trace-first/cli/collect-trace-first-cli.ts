import path from "node:path";

import { TraceFirstScenarioCollector } from "../collection/trace-first-scenario-collector.js";

async function main(): Promise<void> {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const scenarioFilePath = argumentsMap.get("--scenario");
  const scenarioDirectoryPath = argumentsMap.get("--scenarios");
  const syntheticPackDirectoryPath = argumentsMap.get("--packs");
  const outputDirectoryPath = argumentsMap.get("--output");

  if ((!scenarioFilePath && !scenarioDirectoryPath) || !syntheticPackDirectoryPath || !outputDirectoryPath) {
    throw new Error(
      "Usage: node dist/src/evals/trace-first/cli/collect-trace-first-cli.js (--scenario <file> | --scenarios <dir>) --packs <dir> --output <dir>"
    );
  }

  const collector = new TraceFirstScenarioCollector();
  const bundles = await collector.collect(
    scenarioFilePath
      ? {
          scenarioFilePath: path.resolve(process.cwd(), scenarioFilePath),
          syntheticPackDirectoryPath: path.resolve(process.cwd(), syntheticPackDirectoryPath),
          outputDirectoryPath: path.resolve(process.cwd(), outputDirectoryPath)
        }
      : {
          scenarioDirectoryPath: path.resolve(process.cwd(), scenarioDirectoryPath!),
          syntheticPackDirectoryPath: path.resolve(process.cwd(), syntheticPackDirectoryPath),
          outputDirectoryPath: path.resolve(process.cwd(), outputDirectoryPath)
        }
  );

  console.log(
    JSON.stringify(
      {
        bundleCount: bundles.length,
        outputDirectoryPath: path.resolve(process.cwd(), outputDirectoryPath)
      },
      null,
      2
    )
  );
}

function parseArguments(argumentsList: string[]): Map<string, string> {
  const argumentsMap = new Map<string, string>();

  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];

    if (!key || !value) {
      continue;
    }

    argumentsMap.set(key, value);
  }

  return argumentsMap;
}

await main();

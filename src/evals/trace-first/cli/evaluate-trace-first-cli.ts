import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { TraceFirstScenarioCollector } from "../collection/trace-first-scenario-collector.js";
import { createEvaluationJudge } from "../evaluation/create-evaluation-judge.js";
import { TraceFirstEvaluator } from "../evaluation/trace-first-evaluator.js";

async function main(): Promise<void> {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const bundleDirectoryPath = argumentsMap.get("--bundles");
  const outputDirectoryPath = argumentsMap.get("--output");

  if (!bundleDirectoryPath || !outputDirectoryPath) {
    throw new Error(
      "Usage: node dist/src/evals/trace-first/cli/evaluate-trace-first-cli.js --bundles <dir> --output <dir>"
    );
  }

  const collector = new TraceFirstScenarioCollector();
  const bundles = await collector.loadBundles(path.resolve(process.cwd(), bundleDirectoryPath));
  const evaluator = new TraceFirstEvaluator(createEvaluationJudge());
  const evaluation = await evaluator.evaluate(bundles);
  const driftSummaries = evaluator.summarizeDrift(evaluation.examples);
  const resolvedOutputDirectoryPath = path.resolve(process.cwd(), outputDirectoryPath);

  await mkdir(resolvedOutputDirectoryPath, { recursive: true });
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluated-examples.jsonl"),
    `${evaluation.examples.map((example) => JSON.stringify(example)).join("\n")}\n`
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "peer-efficiency.json"),
    JSON.stringify(evaluation.peerEfficiency, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "variant-group-drift.json"),
    JSON.stringify(driftSummaries, null, 2)
  );
  await writeFile(
    path.join(resolvedOutputDirectoryPath, "evaluation-summary.json"),
    JSON.stringify(
      {
        evaluatedExampleCount: evaluation.examples.length,
        peerGroupCount: evaluation.peerEfficiency.length,
        driftGroupCount: driftSummaries.length
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        evaluatedExampleCount: evaluation.examples.length,
        outputDirectoryPath: resolvedOutputDirectoryPath
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

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ZodType } from "zod";

import { scenarioSchema, type Scenario } from "./scenario-schema.js";
import { syntheticPackSchema, type SyntheticPack } from "./synthetic-pack-schema.js";

export class FixtureFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FixtureFileError";
  }
}

export async function loadScenarioFile(filePath: string): Promise<Scenario> {
  return loadValidatedJsonFile(filePath, scenarioSchema);
}

export async function loadSyntheticPackFile(
  filePath: string
): Promise<SyntheticPack> {
  return loadValidatedJsonFile(filePath, syntheticPackSchema);
}

export async function loadSyntheticPackDirectory(
  directoryPath: string
): Promise<SyntheticPack[]> {
  const filePaths = await listJsonFiles(directoryPath);
  return Promise.all(filePaths.map((filePath) => loadSyntheticPackFile(filePath)));
}

export async function loadScenarioDirectory(
  directoryPath: string
): Promise<Scenario[]> {
  const filePaths = await listJsonFiles(directoryPath);
  return Promise.all(filePaths.map((filePath) => loadScenarioFile(filePath)));
}

async function loadValidatedJsonFile<TSchemaOutput>(
  filePath: string,
  schema: ZodType<TSchemaOutput>
): Promise<TSchemaOutput> {
  const fileContents = await readJsonFile(filePath);
  return parseFixtureFile(filePath, fileContents, schema);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  let fileContents: string;

  try {
    fileContents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new FixtureFileError(`Failed to read fixture file: ${filePath}`, {
      cause: error
    });
  }

  try {
    return JSON.parse(fileContents) as unknown;
  } catch (error) {
    throw new FixtureFileError(`Fixture file is not valid JSON: ${filePath}`, {
      cause: error
    });
  }
}

function parseFixtureFile<TSchemaOutput>(
  filePath: string,
  fileContents: unknown,
  schema: ZodType<TSchemaOutput>
): TSchemaOutput {
  const parseResult = schema.safeParse(fileContents);

  if (parseResult.success) {
    return parseResult.data;
  }

  throw new FixtureFileError(
    `Fixture file failed validation: ${filePath}\n${formatZodIssues(parseResult.error.issues)}`
  );
}

async function listJsonFiles(directoryPath: string): Promise<string[]> {
  let directoryEntries: string[];

  try {
    directoryEntries = await readdir(directoryPath);
  } catch (error) {
    throw new FixtureFileError(
      `Failed to list fixture directory: ${directoryPath}`,
      {
        cause: error
      }
    );
  }

  return directoryEntries
    .filter((entryName) => entryName.endsWith(".json"))
    .sort()
    .map((entryName) => path.join(directoryPath, entryName));
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
): string {
  return issues
    .map((issue) => {
      const issuePath =
        issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");

      return `- ${issuePath}: ${issue.message}`;
    })
    .join("\n");
}

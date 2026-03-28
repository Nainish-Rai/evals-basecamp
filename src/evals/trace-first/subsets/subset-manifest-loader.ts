import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  subsetManifestSchema,
  type SubsetManifest
} from "../contracts/subset-manifest-schema.js";

export async function loadSubsetManifestFile(
  filePath: string
): Promise<SubsetManifest> {
  return subsetManifestSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")) as unknown
  );
}

export async function loadSubsetManifestById(
  subsetId: string,
  rootPath = process.cwd()
): Promise<SubsetManifest> {
  return loadSubsetManifestFile(
    path.join(rootPath, "baselines", "subsets", `${subsetId}.json`)
  );
}

export type ArtifactRegistrySourceKind =
  | "scenario_artifact"
  | "synthetic_pack_artifact"
  | "synthetic_pack_data_source"
  | "scenario_data_source"
  | "workspace_seed"
  | "context_variant"
  | "prompt_variant";

export type ArtifactRegistryEntry = {
  entryId: string;
  sourceKind: ArtifactRegistrySourceKind;
  sourceId: string;
  title: string;
  path: string;
  description: string;
};

export class ArtifactRegistry {
  private readonly entries: ArtifactRegistryEntry[] = [];

  addEntry(entry: Omit<ArtifactRegistryEntry, "entryId">): ArtifactRegistryEntry {
    const registeredEntry: ArtifactRegistryEntry = {
      entryId: `artifact-registry-entry-${this.entries.length + 1}`,
      ...entry
    };

    this.entries.push(registeredEntry);

    return registeredEntry;
  }

  listEntries(): ArtifactRegistryEntry[] {
    return [...this.entries];
  }
}

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MemoryEvaluationSpec } from "../../domain/scenarios/memory-evaluation-schema.js";
import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { SyntheticPack } from "../../domain/scenarios/synthetic-pack-schema.js";
import {
  ArtifactRegistry,
  type ArtifactRegistryEntry
} from "../artifacts/artifact-registry.js";

export type MaterializedCaseEnvironment = {
  rootPath: string;
  workspacePath: string;
  registryEntries: ArtifactRegistryEntry[];
  surfacedContext: Scenario["contextEvaluationSpec"];
  surfacedDrift: Scenario["driftEvaluationSpec"];
  surfacedMemory: MemoryEvaluationSpec | null;
};

export type CaseEnvironmentMaterializerRequest = {
  scenario: Scenario;
  syntheticPacksById: Map<string, SyntheticPack>;
  outputRootPath?: string;
};

export class CaseEnvironmentMaterializer {
  async materialize(
    request: CaseEnvironmentMaterializerRequest
  ): Promise<MaterializedCaseEnvironment> {
    const rootPath = await this.createRootPath(request.outputRootPath);
    const workspacePath = path.join(rootPath, request.scenario.materialization.workspaceRoot);
    const artifactRegistry = new ArtifactRegistry();

    await mkdir(workspacePath, { recursive: true });

    if (request.scenario.materialization.includeScenarioArtifacts) {
      await this.materializeScenarioArtifacts(
        request.scenario,
        rootPath,
        artifactRegistry
      );
    }

    await this.materializeScenarioDataSources(
      request.scenario,
      rootPath,
      artifactRegistry
    );
    await this.materializeSyntheticPackReferences(
      request.scenario,
      request.syntheticPacksById,
      rootPath,
      artifactRegistry
    );
    await this.materializeWorkspaceSeed(
      request.scenario,
      rootPath,
      artifactRegistry
    );
    await this.materializeContextVariants(
      request.scenario,
      rootPath,
      artifactRegistry
    );
    await this.materializePromptVariants(
      request.scenario,
      rootPath,
      artifactRegistry
    );

    return {
      rootPath,
      workspacePath,
      registryEntries: artifactRegistry.listEntries(),
      surfacedContext: request.scenario.contextEvaluationSpec,
      surfacedDrift: request.scenario.driftEvaluationSpec,
      surfacedMemory: request.scenario.memoryEvaluationSpec ?? null
    };
  }

  private async createRootPath(outputRootPath?: string): Promise<string> {
    if (outputRootPath) {
      await mkdir(outputRootPath, { recursive: true });
      return outputRootPath;
    }

    return mkdtemp(path.join(tmpdir(), "evals-basecamp-scenario-"));
  }

  private async materializeScenarioArtifacts(
    scenario: Scenario,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    for (const artifact of scenario.artifacts) {
      const artifactPath = path.join(rootPath, "scenario-artifacts", artifact.path);

      await this.writeJsonFile(artifactPath, {
        scenarioId: scenario.scenarioId,
        artifact
      });

      artifactRegistry.addEntry({
        sourceKind: "scenario_artifact",
        sourceId: artifact.artifactId,
        title: artifact.title,
        path: artifactPath,
        description: `Materialized scenario artifact for ${scenario.scenarioId}`
      });
    }
  }

  private async materializeScenarioDataSources(
    scenario: Scenario,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    for (const dataSource of scenario.availableDataSources) {
      const dataSourcePath = path.join(
        rootPath,
        "scenario-data-sources",
        `${dataSource.sourceId}.json`
      );

      await this.writeJsonFile(dataSourcePath, {
        scenarioId: scenario.scenarioId,
        dataSource
      });

      artifactRegistry.addEntry({
        sourceKind: "scenario_data_source",
        sourceId: dataSource.sourceId,
        title: dataSource.sourceId,
        path: dataSourcePath,
        description: `Materialized scenario data source for ${scenario.scenarioId}`
      });
    }
  }

  private async materializeSyntheticPackReferences(
    scenario: Scenario,
    syntheticPacksById: Map<string, SyntheticPack>,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    const orderedReferences = this.orderSyntheticPackReferences(scenario);

    for (const packReference of orderedReferences) {
      const syntheticPack = syntheticPacksById.get(packReference.packId);

      if (!syntheticPack) {
        throw new Error(`Unknown synthetic pack: ${packReference.packId}`);
      }

      for (const entryId of packReference.entryIds) {
        const packEntry = syntheticPack.entries.find((entry) => entry.entryId === entryId);

        if (!packEntry) {
          throw new Error(
            `Unknown synthetic pack entry: ${packReference.packId}/${entryId}`
          );
        }

        await this.materializeSyntheticPackEntry(
          packReference.destinationPath,
          packReference.materializationTargets,
          packEntry,
          rootPath,
          artifactRegistry
        );
      }
    }
  }

  private orderSyntheticPackReferences(scenario: Scenario) {
    const orderedReferenceIds = scenario.materialization.syntheticPackReferenceOrder;

    if (orderedReferenceIds.length === 0) {
      return scenario.syntheticPackReferences;
    }

    const referencesById = new Map(
      scenario.syntheticPackReferences.map((reference) => [reference.referenceId, reference])
    );

    return orderedReferenceIds.flatMap((referenceId) => {
      const reference = referencesById.get(referenceId);
      return reference ? [reference] : [];
    });
  }

  private async materializeSyntheticPackEntry(
    destinationPath: string,
    materializationTargets: string[],
    packEntry: SyntheticPack["entries"][number],
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    const baseDestinationPath = path.join(rootPath, destinationPath);

    if (materializationTargets.includes("artifacts")) {
      for (const artifact of packEntry.artifacts) {
        const artifactPath = path.join(baseDestinationPath, "artifacts", artifact.path);

        await this.writeJsonFile(artifactPath, {
          packEntryId: packEntry.entryId,
          artifact
        });

        artifactRegistry.addEntry({
          sourceKind: "synthetic_pack_artifact",
          sourceId: artifact.artifactId,
          title: artifact.title,
          path: artifactPath,
          description: `Materialized synthetic pack artifact for ${packEntry.entryId}`
        });
      }
    }

    if (materializationTargets.includes("data_sources")) {
      for (const dataSource of packEntry.dataSources) {
        const dataSourcePath = path.join(
          baseDestinationPath,
          "data-sources",
          `${dataSource.sourceId}.json`
        );

        await this.writeJsonFile(dataSourcePath, {
          packEntryId: packEntry.entryId,
          dataSource,
          facts: packEntry.facts
        });

        artifactRegistry.addEntry({
          sourceKind: "synthetic_pack_data_source",
          sourceId: dataSource.sourceId,
          title: dataSource.sourceId,
          path: dataSourcePath,
          description: `Materialized synthetic pack data source for ${packEntry.entryId}`
        });
      }
    }

    if (materializationTargets.includes("workspace")) {
      const workspaceSeedPath = path.join(
        baseDestinationPath,
        "workspace-seeds",
        `${packEntry.entryId}.md`
      );

      const workspaceSeedContents = [
        `# ${packEntry.title}`,
        "",
        `entryId: ${packEntry.entryId}`,
        "",
        packEntry.summary,
        "",
        "## Facts",
        JSON.stringify(packEntry.facts, null, 2)
      ].join("\n");

      await this.writeTextFile(workspaceSeedPath, workspaceSeedContents);

      artifactRegistry.addEntry({
        sourceKind: "workspace_seed",
        sourceId: packEntry.entryId,
        title: packEntry.title,
        path: workspaceSeedPath,
        description: `Workspace seed for ${packEntry.entryId}`
      });
    }
  }

  private async materializeWorkspaceSeed(
    scenario: Scenario,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    const workspaceSeedPath = path.join(
      rootPath,
      scenario.materialization.workspaceRoot,
      "scenario-overview.json"
    );

    await this.writeJsonFile(workspaceSeedPath, {
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      caseBrief: scenario.caseBrief,
      availableTools: scenario.availableTools,
      expectedOutcomeIds: scenario.expectedOutcomes.map((outcome) => outcome.findingId)
    });

    artifactRegistry.addEntry({
      sourceKind: "workspace_seed",
      sourceId: scenario.scenarioId,
      title: scenario.title,
      path: workspaceSeedPath,
      description: `Scenario overview seed for ${scenario.scenarioId}`
    });
  }

  private async materializeContextVariants(
    scenario: Scenario,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    const contextVariantDefinitions = [
      {
        variantId: "ablation",
        payload: {
          requiredContext: scenario.contextEvaluationSpec.requiredContext
        }
      },
      {
        variantId: "distractor-injection",
        payload: {
          distractorContext: scenario.contextEvaluationSpec.distractorContext
        }
      },
      {
        variantId: "progressive-context",
        payload: {
          requiredContext: scenario.contextEvaluationSpec.requiredContext,
          optionalContext: scenario.contextEvaluationSpec.optionalContext
        }
      },
      {
        variantId: "budget-constrained-rerun",
        payload: {
          contextScenarioType: scenario.contextEvaluationSpec.contextScenarioType,
          minimumCorrectnessThreshold:
            scenario.contextEvaluationSpec.minimumCorrectnessThreshold
        }
      }
    ];

    for (const variantDefinition of contextVariantDefinitions) {
      const variantPath = path.join(
        rootPath,
        "variants",
        "context",
        `${variantDefinition.variantId}.json`
      );

      await this.writeJsonFile(variantPath, variantDefinition.payload);

      artifactRegistry.addEntry({
        sourceKind: "context_variant",
        sourceId: variantDefinition.variantId,
        title: variantDefinition.variantId,
        path: variantPath,
        description: `Context variant ${variantDefinition.variantId} for ${scenario.scenarioId}`
      });
    }
  }

  private async materializePromptVariants(
    scenario: Scenario,
    rootPath: string,
    artifactRegistry: ArtifactRegistry
  ): Promise<void> {
    const toolSurfaceProfile = scenario.contextEvaluationSpec.toolSurfaceProfile;
    const promptVariantDefinitions = [
      {
        variantId: "prompt-overhead-analysis",
        payload: scenario.contextEvaluationSpec.systemPromptProfile
      },
      {
        variantId: "duplicate-tool-analysis",
        payload: {
          overlappingToolNames: toolSurfaceProfile.overlappingToolNames,
          duplicateToolRisk: toolSurfaceProfile.duplicateToolRisk
        }
      },
      {
        variantId: "tool-definition-size-analysis",
        payload: {
          toolDefinitionTokenOverhead: toolSurfaceProfile.toolDefinitionTokenOverhead,
          expectedActiveTools: toolSurfaceProfile.expectedActiveTools
        }
      }
    ];

    for (const variantDefinition of promptVariantDefinitions) {
      const variantPath = path.join(
        rootPath,
        "variants",
        "prompt",
        `${variantDefinition.variantId}.json`
      );

      await this.writeJsonFile(variantPath, variantDefinition.payload);

      artifactRegistry.addEntry({
        sourceKind: "prompt_variant",
        sourceId: variantDefinition.variantId,
        title: variantDefinition.variantId,
        path: variantPath,
        description: `Prompt variant ${variantDefinition.variantId} for ${scenario.scenarioId}`
      });
    }
  }

  private async writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(payload, null, 2));
  }

  private async writeTextFile(filePath: string, contents: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
}

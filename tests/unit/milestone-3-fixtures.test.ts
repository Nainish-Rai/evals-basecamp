import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadScenarioDirectory,
  loadSyntheticPackDirectory
} from "../../src/domain/scenarios/scenario-loader.js";

const fixtureRoot = path.resolve(process.cwd(), "fixtures");

describe("Milestone 3 fixture coverage", () => {
  it("matches the first-batch scenario and pack requirements", async () => {
    const [scenarios, packs] = await Promise.all([
      loadScenarioDirectory(path.join(fixtureRoot, "scenarios")),
      loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"))
    ]);

    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    expect(packs).toHaveLength(4);

    const scenariosByTaskFamily = countBy(
      scenarios.map((scenario) => scenario.taskFamily)
    );
    expect(scenariosByTaskFamily.compliance).toBeGreaterThanOrEqual(3);
    expect(scenariosByTaskFamily.governance).toBeGreaterThanOrEqual(3);
    expect(scenariosByTaskFamily.investigation).toBeGreaterThanOrEqual(3);
    expect(scenariosByTaskFamily.risk).toBeGreaterThanOrEqual(3);

    const scenariosByAgentFamily = countBy(
      scenarios.map((scenario) => scenario.agentFamily)
    );
    expect(scenariosByAgentFamily.tool_chain).toBeGreaterThan(0);
    expect(scenariosByAgentFamily.workspace).toBeGreaterThan(0);

    const feedbackAwareScenarioCount = scenarios.filter(
      (scenario) => scenario.feedbackTurns.length > 0
    ).length;
    expect(feedbackAwareScenarioCount).toBeGreaterThanOrEqual(6);

    const driftCriticalities = new Set(
      scenarios.map((scenario) => scenario.driftEvaluationSpec.driftCriticality)
    );
    expect(driftCriticalities.has("outcome_only_drift")).toBe(true);
    expect(driftCriticalities.has("trajectory_only_drift")).toBe(true);
    expect(driftCriticalities.has("quality_preserving_variation")).toBe(true);

    const outcomeDriftCount = scenarios.filter(
      (scenario) =>
        scenario.driftEvaluationSpec.driftCriticality === "outcome_only_drift"
    ).length;
    const trajectoryDriftCount = scenarios.filter(
      (scenario) =>
        scenario.driftEvaluationSpec.driftCriticality ===
        "trajectory_only_drift"
    ).length;
    const qualityPreservingCount = scenarios.filter(
      (scenario) =>
        scenario.driftEvaluationSpec.driftCriticality ===
        "quality_preserving_variation"
    ).length;

    expect(outcomeDriftCount).toBeGreaterThanOrEqual(2);
    expect(trajectoryDriftCount).toBeGreaterThanOrEqual(2);
    expect(qualityPreservingCount).toBeGreaterThanOrEqual(2);

    const contextScenarioTypes = new Set(
      scenarios.map(
        (scenario) => scenario.contextEvaluationSpec.contextScenarioType
      )
    );
    for (const requiredContextScenarioType of [
      "minimal_sufficient_context",
      "under_context_failure",
      "over_context_bloat",
      "wrong_context_retrieval",
      "duplicate_context_waste",
      "mispartitioned_context",
      "stale_or_superseded_context",
      "artifact_reuse_vs_regeneration",
      "budget_constrained_prioritization"
    ] as const) {
      expect(contextScenarioTypes.has(requiredContextScenarioType)).toBe(true);
    }

    const expectedMemoryStates = new Set(
      scenarios.map(
        (scenario) => scenario.memoryEvaluationSpec?.expectedMemoryState
      )
    );
    for (const requiredMemoryState of [
      "correct_save_correct_needed_retrieval",
      "correct_save_failed_needed_retrieval",
      "correct_abstention_from_saving",
      "missed_save_later_needed",
      "wasteful_save_wrongly_used",
      "correct_save_irrelevant_retrieval",
      "correct_save_correct_abstention_from_retrieval",
      "missed_save_no_current_harm_yet",
      "wasteful_save_not_used"
    ] as const) {
      expect(expectedMemoryStates.has(requiredMemoryState)).toBe(true);
    }

    const memorySources = new Set(
      scenarios.flatMap(
        (scenario) => scenario.memoryEvaluationSpec?.memorySources ?? []
      )
    );
    for (const memorySource of ["trace_tool_file", "user", "pattern"] as const) {
      expect(memorySources.has(memorySource)).toBe(true);
    }

    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.systemPromptProfile
            .fixedTokenOverhead >= 300
      )
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.toolSurfaceProfile
            .toolDefinitionTokenOverhead >= 240
      )
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.toolSurfaceProfile.overlappingToolNames
            .length > 0
      )
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.multimodalOptimizationExpectations
            .length > 0
      )
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.fileReadCleanupExpectations.length > 0
      )
    ).toBe(true);
    expect(
      scenarios.some(
        (scenario) =>
          scenario.contextEvaluationSpec.toolSurfaceProfile.ambiguityHotspots
            .length > 0
      )
    ).toBe(true);
  });

  it("keeps scenario pack references aligned with pack contents", async () => {
    const [scenarios, packs] = await Promise.all([
      loadScenarioDirectory(path.join(fixtureRoot, "scenarios")),
      loadSyntheticPackDirectory(path.join(fixtureRoot, "packs"))
    ]);

    const packEntriesByPackId = new Map(
      packs.map((pack) => [
        pack.packId,
        new Set(pack.entries.map((entry) => entry.entryId))
      ])
    );

    for (const scenario of scenarios) {
      for (const packReference of scenario.syntheticPackReferences) {
        const entryIds = packEntriesByPackId.get(packReference.packId);

        expect(
          entryIds,
          `${scenario.scenarioId} references ${packReference.packId}`
        ).toBeDefined();

        for (const entryId of packReference.entryIds) {
          expect(
            entryIds?.has(entryId),
            `${scenario.scenarioId} references missing entry ${entryId}`
          ).toBe(true);
        }
      }
    }
  });
});

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

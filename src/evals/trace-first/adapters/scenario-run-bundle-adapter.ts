import path from "node:path";

import type { ScenarioRunResult } from "../../../runtime/runner/scenario-runner.js";
import {
  runBundleSchema,
  type RunBundle
} from "../contracts/run-bundle-schema.js";

export class ScenarioRunBundleAdapter {
  adapt(
    runResult: ScenarioRunResult,
    options: {
      runBatchId: string;
    }
  ): RunBundle[] {
    return runResult.executions.map((execution, index) =>
      runBundleSchema.parse({
        bundleId: `${runResult.scenarioId}-${execution.mode}-${index + 1}`,
        example: {
          example_id: runResult.scenarioId,
          variation_group_id: runResult.scenarioId,
          task_type: runResult.scenario.taskFamily,
          task: {
            text: runResult.scenario.caseBrief,
            images: []
          },
          instructions: runResult.scenario.caseBrief,
          workspace: runResult.environment.registryEntries.map((entry) =>
            path.relative(runResult.environment.rootPath, entry.path)
          )
        },
        mode: execution.mode,
        runId: execution.runId,
        runBatchId: options.runBatchId,
        traceId:
          execution.agentResult.vendorTraceId ??
          runResult.traceExport?.traceId ??
          null,
        feedbackTurns: runResult.scenario.feedbackTurns,
        evaluationContext: {
          minimumCorrectnessThreshold:
            runResult.scenario.contextEvaluationSpec.minimumCorrectnessThreshold,
          requiredFindings: runResult.scenario.expectedOutcomes.map(
            (expectedOutcome) => expectedOutcome.summary
          ),
          expectedEvidenceRefs: runResult.scenario.expectedOutcomes.flatMap(
            (expectedOutcome) => expectedOutcome.requiredEvidenceRefs
          ),
          correctnessExpectation:
            runResult.scenario.driftEvaluationSpec.expectedOutcomeCriteria
              .correctnessExpectation,
          expectedDisposition:
            runResult.scenario.driftEvaluationSpec.expectedOutcomeCriteria
              .expectedDisposition,
          requiredContext:
            runResult.scenario.contextEvaluationSpec.requiredContext,
          optionalContext:
            runResult.scenario.contextEvaluationSpec.optionalContext,
          distractorContext:
            runResult.scenario.contextEvaluationSpec.distractorContext,
          duplicateContext:
            runResult.scenario.contextEvaluationSpec.duplicateContext,
          staleContext: runResult.scenario.contextEvaluationSpec.staleContext,
          expectedActiveTools:
            runResult.scenario.contextEvaluationSpec.toolSurfaceProfile
              .expectedActiveTools,
          overlappingToolNames:
            runResult.scenario.contextEvaluationSpec.toolSurfaceProfile
              .overlappingToolNames,
          memoryCheckpoints:
            runResult.scenario.memoryEvaluationSpec?.memoryCheckpoints.map(
              (checkpoint) => ({
                checkpointId: checkpoint.checkpointId,
                description: checkpoint.rationale
              })
            ) ?? [],
          contextCheckpoints:
            runResult.scenario.contextEvaluationSpec.requiredContext.map(
              (contextItem, contextIndex) => ({
                checkpointId: `context-${contextIndex + 1}`,
                description: contextItem
              })
            ),
          staticOverhead: {
            systemPromptTokens:
              runResult.scenario.contextEvaluationSpec.systemPromptProfile
                .fixedTokenOverhead +
              runResult.scenario.contextEvaluationSpec.systemPromptProfile
                .dynamicTokenOverhead,
            toolDefinitionTokens:
              runResult.scenario.contextEvaluationSpec.toolSurfaceProfile
                .toolDefinitionTokenOverhead
          }
        },
        feedbackIds: execution.feedbackIds,
        finalResponse: execution.agentResult.summary,
        outputArtifacts: execution.agentResult.outputArtifacts,
        tokenUsage: execution.agentResult.tokenUsage,
        agentMetadata: execution.agentResult.metadata ?? {},
        trace: execution.agentResult.vendorTraceId
          ? null
          : runResult.traceExport,
        collectedAt: new Date().toISOString(),
        agentLabel: runResult.scenario.agentFamily,
        modelLabel: "local-scenario-agent"
      })
    );
  }
}

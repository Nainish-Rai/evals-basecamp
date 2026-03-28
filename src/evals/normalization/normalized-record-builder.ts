import path from "node:path";

import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { NormalizedEvaluationRecord } from "../contracts/normalized-evaluation-record.js";
import { normalizedEvaluationRecordSchema } from "../contracts/normalized-evaluation-record.js";
import type { MaterializedCaseEnvironment } from "../../runtime/materialization/case-environment-materializer.js";
import type {
  ScenarioExecutionResult,
  ScenarioRunResult
} from "../../runtime/runner/scenario-runner.js";

type NormalizedRecordOverrides = Partial<NormalizedEvaluationRecord> &
  Pick<
    NormalizedEvaluationRecord,
    | "finalResponse"
    | "contextMetrics"
    | "tokenUsage"
    | "latencyMs"
    | "memoryImpact"
  >;

export type NormalizedRecordBuilderInput = {
  runResult: ScenarioRunResult;
  execution: ScenarioExecutionResult;
  overrides: NormalizedRecordOverrides;
};

export class NormalizedRecordBuilder {
  build(input: NormalizedRecordBuilderInput): NormalizedEvaluationRecord {
    const { runResult, execution, overrides } = input;
    const feedbackTurns = findExecutionFeedbackTurns(runResult.scenario, execution.feedbackIds);
    const turnId = resolveTurnId(execution, feedbackTurns);
    const runId = buildRunId(runResult, execution, turnId);

    return normalizedEvaluationRecordSchema.parse({
      scenarioId: runResult.scenarioId,
      runId,
      agentFamily: runResult.scenario.agentFamily,
      taskFamily: runResult.scenario.taskFamily,
      turnId,
      inputTask: runResult.scenario.caseBrief,
      feedbackInputs: feedbackTurns.map((feedbackTurn) => feedbackTurn.feedbackId),
      groundedEvidenceRefs: collectDefaultGroundedEvidenceRefs(runResult.scenario),
      retrievalEvents: [],
      filesystemArtifacts: createFilesystemArtifacts(
        runResult.environment,
        execution.agentResult.outputArtifacts
      ),
      subagentEvents: [],
      memoryCandidatesObserved: [],
      memoryReads: [],
      memoryWrites: [],
      memoryWritesSkipped: [],
      memorySources: runResult.scenario.memoryEvaluationSpec?.memorySources ?? [],
      memoryScopes: runResult.scenario.memoryEvaluationSpec
        ? [runResult.scenario.memoryEvaluationSpec.memoryScope]
        : [],
      memoryWorthKeeping:
        runResult.scenario.memoryEvaluationSpec?.memoryOpportunities
          .filter((opportunity) => opportunity.worthKeeping)
          .map((opportunity) => opportunity.opportunityId) ?? [],
      memoryRetrieved: [],
      memoryNeededNow:
        collectNeededMemoryIdsForTurn(runResult.scenario, turnId),
      memoryUsedInDecision: [],
      memoryFailureTypes: [],
      graphPath: [],
      langfuseTraceId: runResult.traceContext.traceId,
      ...overrides
    });
  }
}

export function buildRunId(
  runResult: ScenarioRunResult,
  execution: ScenarioExecutionResult,
  turnId: string
): string {
  const traceIdentifier = runResult.traceContext.traceId ?? runResult.scenarioId;

  return `${traceIdentifier}-${execution.mode}-${turnId}`;
}

export function findExecutionFeedbackTurns(
  scenario: Scenario,
  feedbackIds: string[]
): Scenario["feedbackTurns"] {
  const requestedFeedbackIds = new Set(feedbackIds);

  return scenario.feedbackTurns.filter((feedbackTurn) =>
    requestedFeedbackIds.has(feedbackTurn.feedbackId)
  );
}

function resolveTurnId(
  execution: ScenarioExecutionResult,
  feedbackTurns: Scenario["feedbackTurns"]
): string {
  if (execution.mode === "initial") {
    return "turn-1";
  }

  return feedbackTurns.at(-1)?.turnId ?? "turn-feedback-rerun";
}

function createFilesystemArtifacts(
  environment: MaterializedCaseEnvironment,
  outputArtifacts: string[]
): Array<{
  artifactId: string;
  path: string;
  kind: "input" | "generated" | "workspace";
  tokenCount: number;
}> {
  const normalizedOutputArtifacts = outputArtifacts.map((outputArtifactPath) =>
    normalizeOutputArtifactPath(environment.rootPath, outputArtifactPath)
  );
  const registryArtifacts = environment.registryEntries.map((entry) => ({
    artifactId: entry.sourceId,
    path: path.relative(environment.rootPath, entry.path),
    kind: classifyFilesystemArtifact(
      entry.path,
      environment.workspacePath,
      new Set(normalizedOutputArtifacts.map((artifact) => artifact.absolutePath ?? artifact.path))
    ),
    tokenCount: estimateTokenCount(entry.path)
  }));
  const existingPaths = new Set(registryArtifacts.map((artifact) => artifact.path));
  const generatedArtifacts = normalizedOutputArtifacts
    .filter((outputArtifactPath) => !existingPaths.has(outputArtifactPath.path))
    .map((outputArtifactPath, index) => ({
      artifactId: `generated-artifact-${index + 1}`,
      path: outputArtifactPath.path,
      kind: classifyFilesystemArtifact(
        outputArtifactPath.absolutePath ?? outputArtifactPath.path,
        environment.workspacePath,
        new Set(normalizedOutputArtifacts.map((artifact) => artifact.absolutePath ?? artifact.path))
      ),
      tokenCount: estimateTokenCount(outputArtifactPath.path)
    }));

  return [...registryArtifacts, ...generatedArtifacts];
}

function normalizeOutputArtifactPath(
  rootPath: string,
  outputArtifactPath: string
): {
  absolutePath: string | null;
  path: string;
} {
  if (path.isAbsolute(outputArtifactPath)) {
    return {
      absolutePath: outputArtifactPath,
      path: path.relative(rootPath, outputArtifactPath)
    };
  }

  if (outputArtifactPath.includes(path.sep) || outputArtifactPath.startsWith(".")) {
    return {
      absolutePath: path.resolve(rootPath, outputArtifactPath),
      path: outputArtifactPath
    };
  }

  return {
    absolutePath: null,
    path: outputArtifactPath
  };
}

function classifyFilesystemArtifact(
  artifactPath: string,
  workspacePath: string,
  outputArtifactPaths: Set<string>
): "input" | "generated" | "workspace" {
  if (artifactPath.startsWith(workspacePath)) {
    return "workspace";
  }

  if (outputArtifactPaths.has(artifactPath)) {
    return "generated";
  }

  return "input";
}

function collectDefaultGroundedEvidenceRefs(scenario: Scenario): string[] {
  return [
    ...new Set(
      scenario.expectedOutcomes.flatMap((expectedOutcome) => expectedOutcome.requiredEvidenceRefs)
    )
  ];
}

function estimateTokenCount(value: string): number {
  return Math.max(Math.ceil(path.basename(value).length / 4), 1);
}

function collectNeededMemoryIdsForTurn(
  scenario: Scenario,
  turnId: string
): string[] {
  const memoryEvaluationSpec = scenario.memoryEvaluationSpec;

  if (!memoryEvaluationSpec) {
    return [];
  }

  return [
    ...new Set(
      memoryEvaluationSpec.memoryCheckpoints
        .filter(
          (checkpoint) =>
            checkpoint.turnId === turnId && checkpoint.expectedAction === "retrieve"
        )
        .flatMap((checkpoint) => checkpoint.relatedOpportunityIds)
    )
  ];
}

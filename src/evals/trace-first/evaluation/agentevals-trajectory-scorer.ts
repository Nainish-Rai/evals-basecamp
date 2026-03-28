import {
  createTrajectoryMatchEvaluator,
  type FlexibleChatCompletionMessage,
  type TrajectoryMatchMode
} from "agentevals";

import { metricResultSchema, type MetricResult } from "../../contracts/metric-result-schema.js";
import type { EvalTrajectoryEvaluationSpec } from "../contracts/eval-example-schema.js";
import type { RunBundle } from "../contracts/run-bundle-schema.js";
import { createTrajectoryEvidenceSnapshot } from "./trajectory-evidence-extractor.js";

type EncodedTrajectoryStep = {
  kind: "step" | "tool" | "delegation";
  name: string;
};

export class AgentEvalsTrajectoryScorer {
  async score(bundle: RunBundle): Promise<MetricResult | null> {
    const snapshot = createTrajectoryEvidenceSnapshot(bundle);
    const expectation = readExpectation(bundle);
    const referenceSteps = encodeReferenceSteps(expectation);

    if (referenceSteps.length === 0) {
      return null;
    }

    const observedSteps = encodeObservedSteps(snapshot.observed);
    const evaluator = createTrajectoryMatchEvaluator({
      trajectoryMatchMode: selectMatchMode(expectation),
      toolArgsMatchMode: "ignore"
    });
    const { score } = await evaluator({
      outputs: toTrajectoryMessages(
        normalizeStepsForMatch(observedSteps, expectation)
      ),
      referenceOutputs: toTrajectoryMessages(
        normalizeStepsForMatch(referenceSteps, expectation)
      )
    });
    const passed = score === true;

    return metricResultSchema.parse({
      metricId: `trajectory-agentevals-match:${bundle.bundleId}`,
      metricFamily: "trajectory",
      score: passed ? 1 : 0,
      passed,
      summary: buildSummary(
        selectMatchMode(expectation),
        expectation.allowAdditionalSteps,
        passed
      ),
      details: {
        evaluator: "agentevals",
        trajectoryMatchMode: selectMatchMode(expectation),
        allowAdditionalSteps: expectation.allowAdditionalSteps,
        observedStepNames: observedSteps.map((step) => step.name),
        referenceStepNames: referenceSteps.map((step) => step.name)
      },
      evidenceRefs: []
    });
  }
}

function encodeReferenceSteps(
  expectation: EvalTrajectoryEvaluationSpec
): EncodedTrajectoryStep[] {
  return [
    ...expectation.requiredSteps.map((name) => ({ kind: "step" as const, name })),
    ...expectation.criticalTools.map((name) => ({ kind: "tool" as const, name })),
    ...expectation.criticalDelegations.map((name) => ({
      kind: "delegation" as const,
      name
    }))
  ];
}

function readExpectation(bundle: RunBundle): EvalTrajectoryEvaluationSpec {
  return bundle.example.evaluationSpec.trajectory;
}

function encodeObservedSteps(observed: {
  graphPath: string[];
  toolNames: string[];
  delegationIds: string[];
  delegationTaskSummaries: string[];
}): EncodedTrajectoryStep[] {
  return [
    ...observed.graphPath.map((name) => ({ kind: "step" as const, name })),
    ...observed.toolNames.map((name) => ({ kind: "tool" as const, name })),
    ...[...observed.delegationIds, ...observed.delegationTaskSummaries].map((name) => ({
      kind: "delegation" as const,
      name
    }))
  ];
}

function normalizeStepsForMatch(
  steps: EncodedTrajectoryStep[],
  expectation: EvalTrajectoryEvaluationSpec
): EncodedTrajectoryStep[] {
  const uniqueSteps = dedupeSteps(steps);

  if (
    expectation.allowedStepFlexibility === "unordered" &&
    expectation.allowAdditionalSteps
  ) {
    return [...uniqueSteps].sort(compareEncodedSteps);
  }

  return uniqueSteps;
}

function dedupeSteps(steps: EncodedTrajectoryStep[]): EncodedTrajectoryStep[] {
  const seen = new Set<string>();

  return steps.filter((step) => {
    const key = `${step.kind}:${step.name}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function compareEncodedSteps(
  left: EncodedTrajectoryStep,
  right: EncodedTrajectoryStep
): number {
  return `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`);
}

function toTrajectoryMessages(
  steps: EncodedTrajectoryStep[]
): FlexibleChatCompletionMessage[] {
  return steps.map((step, index) => ({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: `tool-call-${index + 1}`,
        type: "function",
        function: {
          name: `${step.kind}.${step.name}`,
          arguments: "{}"
        }
      }
    ]
  }));
}

function selectMatchMode(
  expectation: EvalTrajectoryEvaluationSpec
): TrajectoryMatchMode {
  switch (expectation.allowedStepFlexibility) {
    case "exact":
      return "strict";
    case "unordered":
      return expectation.allowAdditionalSteps ? "superset" : "unordered";
    case "partial":
    default:
      return "superset";
  }
}

function buildSummary(
  matchMode: TrajectoryMatchMode,
  allowAdditionalSteps: boolean,
  passed: boolean
): string {
  return [
    `AgentEvals trajectory match mode ${matchMode}.`,
    `Allow additional steps ${allowAdditionalSteps}.`,
    `Matched ${passed}.`
  ].join(" ");
}

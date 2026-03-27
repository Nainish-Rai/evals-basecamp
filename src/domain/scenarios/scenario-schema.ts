import { z } from "zod";

import { feedbackEventSchema } from "../feedback/feedback-event-schema.js";
import { contextEvaluationSpecSchema } from "./context-evaluation-schema.js";
import { driftEvaluationSpecSchema } from "./drift-evaluation-schema.js";
import { expectedOutcomeSchema } from "./expected-outcome-schema.js";
import { memoryEvaluationSpecSchema } from "./memory-evaluation-schema.js";
import {
  agentFamilySchema,
  artifactSchema,
  dataSourceSchema,
  difficultySchema,
  evaluationRubricSchema,
  memoryTargetSchema,
  modalitySchema,
  taskFamilySchema,
  trajectoryHintSchema
} from "./scenario-parts.js";
import {
  scenarioMaterializationSchema,
  syntheticPackReferenceSchema
} from "./scenario-materialization-schema.js";

export const scenarioSchema = z
  .object({
    scenarioId: z.string().min(1),
    title: z.string().min(1),
    agentFamily: agentFamilySchema,
    taskFamily: taskFamilySchema,
    difficulty: difficultySchema,
    modalityProfile: z.array(modalitySchema).min(1),
    caseBrief: z.string().min(1),
    environmentSeed: z.string().min(1),
    artifacts: z.array(artifactSchema).default([]),
    availableDataSources: z.array(dataSourceSchema).default([]),
    availableTools: z.array(z.string().min(1)).default([]),
    syntheticPackReferences: z.array(syntheticPackReferenceSchema).default([]),
    materialization: scenarioMaterializationSchema.default({
      workspaceRoot: "workspace",
      includeScenarioArtifacts: true,
      syntheticPackReferenceOrder: []
    }),
    expectedOutcomes: z.array(expectedOutcomeSchema).min(1),
    contextEvaluationSpec: contextEvaluationSpecSchema,
    driftEvaluationSpec: driftEvaluationSpecSchema,
    trajectoryHints: trajectoryHintSchema.default({
      expectedNodes: [],
      requiredSteps: [],
      expectedTools: [],
      criticalDelegations: [],
      allowAdditionalSteps: true
    }),
    feedbackTurns: z.array(feedbackEventSchema).default([]),
    memoryTargets: z.array(memoryTargetSchema).default([]),
    memoryEvaluationSpec: memoryEvaluationSpecSchema.optional(),
    evaluationRubric: evaluationRubricSchema,
    failureModes: z.array(z.string().min(1)).default([])
  })
  .superRefine((value, context) => {
    const packReferenceIds = new Set<string>();
    const availableToolNames = new Set(value.availableTools);
    const expectedOutcomeIds = new Set(
      value.expectedOutcomes.map((expectedOutcome) => expectedOutcome.findingId)
    );
    const supportedModalities = new Set(value.modalityProfile);

    for (const packReference of value.syntheticPackReferences) {
      if (packReferenceIds.has(packReference.referenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "synthetic pack reference IDs must be unique",
          path: ["syntheticPackReferences"]
        });
      }

      packReferenceIds.add(packReference.referenceId);
    }

    for (const referenceId of value.materialization
      .syntheticPackReferenceOrder) {
      if (!packReferenceIds.has(referenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown synthetic pack reference: ${referenceId}`,
          path: ["materialization", "syntheticPackReferenceOrder"]
        });
      }
    }

    for (const toolName of value.trajectoryHints.expectedTools) {
      if (!availableToolNames.has(toolName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown trajectory tool: ${toolName}`,
          path: ["trajectoryHints", "expectedTools"]
        });
      }
    }

    for (const toolName of value.contextEvaluationSpec.toolSurfaceProfile
      .expectedActiveTools) {
      if (!availableToolNames.has(toolName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown active tool in context evaluation: ${toolName}`,
          path: [
            "contextEvaluationSpec",
            "toolSurfaceProfile",
            "expectedActiveTools"
          ]
        });
      }
    }

    for (const toolName of value.driftEvaluationSpec.trajectory.criticalTools) {
      if (!availableToolNames.has(toolName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown critical tool in drift evaluation: ${toolName}`,
          path: ["driftEvaluationSpec", "trajectory", "criticalTools"]
        });
      }
    }

    for (const findingId of value.driftEvaluationSpec.expectedOutcomeCriteria
      .requiredFindings) {
      if (!expectedOutcomeIds.has(findingId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown required finding in drift evaluation: ${findingId}`,
          path: [
            "driftEvaluationSpec",
            "expectedOutcomeCriteria",
            "requiredFindings"
          ]
        });
      }
    }

    for (const expectation of value.contextEvaluationSpec
      .multimodalOptimizationExpectations) {
      if (!supportedModalities.has(expectation.modality)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unsupported multimodal modality for scenario: ${expectation.modality}`,
          path: ["contextEvaluationSpec", "multimodalOptimizationExpectations"]
        });
      }
    }
  });

export type Scenario = z.infer<typeof scenarioSchema>;

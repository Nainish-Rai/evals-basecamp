import { z } from "zod";

import { feedbackEventSchema } from "../feedback/feedback-event-schema.js";
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
    trajectoryHints: trajectoryHintSchema.default({
      expectedNodes: [],
      expectedTools: [],
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

    for (const referenceId of value.materialization.syntheticPackReferenceOrder) {
      if (!packReferenceIds.has(referenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown synthetic pack reference: ${referenceId}`,
          path: ["materialization", "syntheticPackReferenceOrder"]
        });
      }
    }
  });

export type Scenario = z.infer<typeof scenarioSchema>;

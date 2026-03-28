import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { feedbackEventSchema } from "../../domain/feedback/feedback-event-schema.js";
import {
  contextEvaluationSpecSchema
} from "../../domain/scenarios/context-evaluation-schema.js";
import { driftEvaluationSpecSchema } from "../../domain/scenarios/drift-evaluation-schema.js";
import { expectedOutcomeSchema } from "../../domain/scenarios/expected-outcome-schema.js";
import { memoryEvaluationSpecSchema } from "../../domain/scenarios/memory-evaluation-schema.js";
import {
  agentFamilySchema,
  difficultySchema,
  modalitySchema,
  taskFamilySchema
} from "../../domain/scenarios/scenario-parts.js";
import type { Scenario } from "../../domain/scenarios/scenario-schema.js";
import type { ArtifactRegistryEntry } from "../artifacts/artifact-registry.js";
import type {
  ScenarioAgent,
  ScenarioAgentRunRequest,
  ScenarioAgentRunResult
} from "./stub-scenario-agent.js";

const artifactSnapshotSchema = z.object({
  entryId: z.string().min(1),
  sourceKind: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
  contentType: z.enum(["application/json", "text/markdown", "text/plain"])
});

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});

const externalAgentResponseSchema = z.object({
  summary: z.string().min(1),
  outputArtifacts: z.array(z.string().min(1)).default([]),
  tokenUsage: tokenUsageSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  vendorTraceId: z.string().min(1).nullable().optional()
});

const externalAgentScenarioSchema = z.object({
  scenarioId: z.string().min(1),
  title: z.string().min(1),
  agentFamily: agentFamilySchema,
  taskFamily: taskFamilySchema,
  difficulty: difficultySchema,
  modalityProfile: z.array(modalitySchema).min(1),
  caseBrief: z.string().min(1),
  availableTools: z.array(z.string().min(1)),
  expectedOutcomes: z.array(expectedOutcomeSchema)
});

const externalAgentRequestSchema = z.object({
  scenario: externalAgentScenarioSchema,
  execution: z.object({
    mode: z.enum(["initial", "feedback_rerun"]),
    runId: z.string().min(1),
    feedbackTurns: z.array(feedbackEventSchema)
  }),
  environment: z.object({
    workspaceRoot: z.string().min(1),
    artifactSnapshots: z.array(artifactSnapshotSchema),
    surfacedContext: contextEvaluationSpecSchema,
    surfacedDrift: driftEvaluationSpecSchema,
    surfacedMemory: memoryEvaluationSpecSchema.nullable()
  }),
  traceContext: z.object({
    traceId: z.string().min(1).nullable(),
    enabled: z.boolean()
  })
});

export type ExternalAgentExecutionRequest = z.infer<
  typeof externalAgentRequestSchema
>;

export type ExternalAgentExecutionResponse = z.infer<
  typeof externalAgentResponseSchema
>;

export type HttpScenarioAgentOptions = {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
};

export class HttpScenarioAgentError extends Error {}

export class HttpScenarioAgentTimeoutError extends HttpScenarioAgentError {}

export class HttpScenarioAgentResponseError extends HttpScenarioAgentError {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string
  ) {
    super(`External agent request failed with status ${statusCode}`);
  }
}

export class HttpScenarioAgentResponseValidationError extends HttpScenarioAgentError {
  constructor(message: string) {
    super(`External agent response did not match the contract: ${message}`);
  }
}

export class HttpScenarioAgent implements ScenarioAgent {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpScenarioAgentOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async run(request: ScenarioAgentRunRequest): Promise<ScenarioAgentRunResult> {
    return request.trace.runInSpan(
      {
        name: "external_agent_http_call",
        kind: "agent_http_call",
        metadata: {
          endpoint: this.options.endpoint,
          executionMode: request.executionPlan.mode,
          timeoutMs: this.timeoutMs
        }
      },
      async () => {
        const payload = await this.buildExecutionRequest(request);
        const response = await this.callExternalAgent(payload, request.runId);

        if (response.vendorTraceId) {
          request.trace.attachVendorTraceId(response.vendorTraceId);
        }

        return {
          summary: response.summary,
          outputArtifacts: response.outputArtifacts,
          tokenUsage: response.tokenUsage,
          metadata: response.metadata,
          vendorTraceId: response.vendorTraceId ?? null
        };
      }
    );
  }

  private async buildExecutionRequest(
    request: ScenarioAgentRunRequest
  ): Promise<ExternalAgentExecutionRequest> {
    return externalAgentRequestSchema.parse({
      scenario: this.pickScenarioFields(request.scenario),
      execution: {
        mode: request.executionPlan.mode,
        runId: request.runId,
        feedbackTurns: request.executionPlan.feedbackTurns
      },
      environment: {
        workspaceRoot: path.relative(
          request.environment.rootPath,
          request.environment.workspacePath
        ),
        artifactSnapshots: await this.snapshotArtifacts(
          request.environment.rootPath,
          request.environment.registryEntries
        ),
        surfacedContext: request.environment.surfacedContext,
        surfacedDrift: request.environment.surfacedDrift,
        surfacedMemory: request.environment.surfacedMemory
      },
      traceContext: {
        traceId: request.trace.snapshot().traceId,
        enabled: request.trace.snapshot().enabled
      }
    });
  }

  private pickScenarioFields(scenario: Scenario): ExternalAgentExecutionRequest["scenario"] {
    return {
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      agentFamily: scenario.agentFamily,
      taskFamily: scenario.taskFamily,
      difficulty: scenario.difficulty,
      modalityProfile: scenario.modalityProfile,
      caseBrief: scenario.caseBrief,
      availableTools: scenario.availableTools,
      expectedOutcomes: scenario.expectedOutcomes
    };
  }

  private async snapshotArtifacts(
    rootPath: string,
    registryEntries: ArtifactRegistryEntry[]
  ): Promise<ExternalAgentExecutionRequest["environment"]["artifactSnapshots"]> {
    return Promise.all(
      registryEntries.map(async (entry) => ({
        entryId: entry.entryId,
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        title: entry.title,
        description: entry.description,
        relativePath: path.relative(rootPath, entry.path),
        content: await readFile(entry.path, "utf8"),
        contentType: determineContentType(entry.path)
      }))
    );
  }

  private async callExternalAgent(
    payload: ExternalAgentExecutionRequest,
    runId: string
  ): Promise<ExternalAgentExecutionResponse> {
    let response: Response;
    const endpointUrl = new URL(this.options.endpoint);
    endpointUrl.searchParams.set("run_id", runId);

    try {
      response = await this.fetchImplementation(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? {
                authorization: `Bearer ${this.options.apiKey}`
              }
            : {})
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new HttpScenarioAgentTimeoutError(
          `External agent request timed out after ${this.timeoutMs}ms`
        );
      }

      throw new HttpScenarioAgentError(
        error instanceof Error ? error.message : String(error)
      );
    }

    const responseBody = await response.text();

    if (!response.ok) {
      throw new HttpScenarioAgentResponseError(response.status, responseBody);
    }

    const parsedBody = parseJsonResponse(responseBody);
    const validationResult = externalAgentResponseSchema.safeParse(parsedBody);

    if (!validationResult.success) {
      throw new HttpScenarioAgentResponseValidationError(validationResult.error.message);
    }

    return validationResult.data;
  }
}

function determineContentType(filePath: string): "application/json" | "text/markdown" | "text/plain" {
  if (filePath.endsWith(".json")) {
    return "application/json";
  }

  if (filePath.endsWith(".md")) {
    return "text/markdown";
  }

  return "text/plain";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function parseJsonResponse(responseBody: string): unknown {
  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new HttpScenarioAgentResponseValidationError(
      error instanceof Error ? error.message : "unknown JSON parse error"
    );
  }
}

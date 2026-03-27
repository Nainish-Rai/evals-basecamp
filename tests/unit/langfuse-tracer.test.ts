import { describe, expect, it } from "vitest";

import { LangfuseTracer } from "../../src/runtime/tracing/langfuse-tracer.js";

describe("LangfuseTracer", () => {
  it("returns a disabled trace context when tracing is off", () => {
    const trace = new LangfuseTracer().startTrace({
      name: "scenario_run"
    });

    const context = trace.finish();

    expect(context.enabled).toBe(false);
    expect(context.traceId).toBeNull();
    expect(context.spanCount).toBe(0);
  });

  it("tracks nested spans, scores, events, and vendor trace identifiers", async () => {
    const trace = new LangfuseTracer({ enabled: true }).startTrace({
      name: "scenario_run",
      metadata: {
        scenarioId: "scenario-risk-001"
      }
    });

    await trace.runInSpan(
      {
        name: "outer",
        kind: "runner"
      },
      async () => {
        trace.recordScore({
          name: "correctness",
          value: 0.75
        });
        trace.recordMemoryDecision({
          type: "saved",
          candidateId: "memory-1",
          summary: "Saved a useful fact"
        });

        await trace.runInSpan(
          {
            name: "inner",
            kind: "agent_http_call"
          },
          () => {
            trace.recordEvent("http_response_received", {
              statusCode: 200
            });
            trace.attachVendorTraceId("vendor-trace-123");

            return Promise.resolve();
          }
        );
      }
    );

    const context = trace.finish();

    expect(context.enabled).toBe(true);
    expect(context.traceId).toContain("trace-");
    expect(context.spanCount).toBe(2);
    expect(context.scoreCount).toBe(1);
    expect(context.eventCount).toBe(2);
    expect(context.vendorTraceIds).toEqual(["vendor-trace-123"]);
    expect(context.status).toBe("completed");
  });
});

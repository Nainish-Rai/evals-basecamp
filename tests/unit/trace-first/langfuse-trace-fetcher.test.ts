import { describe, expect, it, vi } from "vitest";

import { LangfuseTraceFetcher } from "../../../src/evals/trace-first/collection/langfuse-trace-fetcher.js";

describe("LangfuseTraceFetcher", () => {
  it("hydrates a trace by runId via Langfuse sessionId lookup", async () => {
    const fetchImplementation = vi.fn((input: string | URL | Request) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname === "/api/public/traces" && url.searchParams.get("sessionId") === "run-1") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "trace-abc",
                  sessionId: "run-1",
                  name: "vendor-run"
                }
              ]
            }),
            { status: 200 }
          )
        );
      }

      if (url.pathname === "/api/public/traces/trace-abc") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "trace-abc",
              sessionId: "run-1",
              name: "vendor-run",
              metadata: {
                source: "langfuse"
              }
            }),
            { status: 200 }
          )
        );
      }

      if (
        url.pathname === "/api/public/observations" &&
        url.searchParams.get("traceId") === "trace-abc"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "span-1",
                  traceId: "trace-abc",
                  name: "subagent-worker",
                  type: "AGENT",
                  startTime: "2026-03-28T00:00:00.000Z",
                  endTime: "2026-03-28T00:00:03.000Z",
                  metadata: {
                    subagentId: "subagent-1",
                    systemPromptTokens: 120
                  }
                },
                {
                  id: "event-1",
                  traceId: "trace-abc",
                  parentObservationId: "span-1",
                  name: "memory.saved",
                  type: "EVENT",
                  createdAt: "2026-03-28T00:00:01.000Z",
                  metadata: {
                    candidateId: "memory-1"
                  }
                }
              ]
            }),
            { status: 200 }
          )
        );
      }

      throw new Error(`Unexpected Langfuse request: ${url.toString()}`);
    });
    const fetcher = new LangfuseTraceFetcher({
      baseUrl: "https://langfuse.onfinance.ai",
      publicKey: "public-key",
      secretKey: "secret-key",
      fetchImplementation
    });

    const trace = await fetcher.fetchTraceByRunId("run-1");

    expect(trace.traceId).toBe("trace-abc");
    expect(trace.metadata).toMatchObject({
      runId: "run-1",
      sessionId: "run-1",
      source: "langfuse"
    });
    expect(trace.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spanId: "span-1",
          kind: "subagent_call"
        })
      ])
    );
    expect(trace.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-1",
          name: "memory.saved"
        })
      ])
    );
  });
});

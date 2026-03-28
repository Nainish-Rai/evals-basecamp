import { describe, expect, it } from "vitest";

import { loadEnvironmentConfig } from "../../src/infra/config/env.js";

describe("loadEnvironmentConfig", () => {
  it("applies defaults when optional values are absent", () => {
    const config = loadEnvironmentConfig({});

    expect(config.NODE_ENV).toBe("development");
    expect(config.LANGFUSE_ENABLED).toBe(false);
    expect(config.EXTERNAL_AGENT_TIMEOUT_MS).toBe(30_000);
    expect(config.DEFAULT_SUBAGENT_MODEL).toContain("mini");
    expect(config.DEFAULT_SUBAGENT_MODEL_TIER).toBe("small");
  });

  it("requires Langfuse credentials when Langfuse is enabled", () => {
    expect(() =>
      loadEnvironmentConfig({
        LANGFUSE_ENABLED: "true"
      })
    ).toThrow(/LANGFUSE_PUBLIC_KEY/);
  });

  it("requires the subagent tier to be smaller than the main model tier", () => {
    expect(() =>
      loadEnvironmentConfig({
        DEFAULT_MAIN_MODEL_TIER: "medium",
        DEFAULT_SUBAGENT_MODEL_TIER: "medium"
      })
    ).toThrow(/DEFAULT_SUBAGENT_MODEL_TIER/);
  });

  it("requires an OpenAI API key when the evaluator agent is enabled", () => {
    expect(() =>
      loadEnvironmentConfig({
        EVALUATOR_AGENT_ENABLED: "true"
      })
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("accepts a custom OpenAI-compatible base URL", () => {
    const config = loadEnvironmentConfig({
      OPENAI_BASE_URL: "http://127.0.0.1:4000/v1"
    });

    expect(config.OPENAI_BASE_URL).toBe("http://127.0.0.1:4000/v1");
  });

  it("accepts a custom API-key header name for OpenAI-compatible gateways", () => {
    const config = loadEnvironmentConfig({
      OPENAI_API_KEY_HEADER_NAME: "x-api-key"
    });

    expect(config.OPENAI_API_KEY_HEADER_NAME).toBe("x-api-key");
  });
});

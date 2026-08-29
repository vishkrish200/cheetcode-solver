import { afterEach, describe, expect, it } from "vitest";

import { hasLlmConfig, requireLlmConfig, resolveLlmConfig, resolveModel, resolveModelCandidates } from "../src/llm/client.js";

const savedEnv = { ...process.env };

describe("resolveModel", () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("keeps Level 1 on the fast default when no model is configured", () => {
    delete process.env.LLM_MODEL;
    delete process.env.SMART_LLM_MODEL;
    delete process.env.LEVEL1_LLM_MODEL;

    expect(resolveModel("level1")).toBe("gpt-oss-120b");
  });

  it("routes Level 2 and Level 3 through the smart shared override", () => {
    process.env.LLM_MODEL = "gpt-oss-120b";
    process.env.SMART_LLM_MODEL = "qwen-3-235b-a22b-instruct-2507";
    delete process.env.LEVEL2_LLM_MODEL;
    delete process.env.LEVEL3_LLM_MODEL;

    expect(resolveModel("level2")).toBe("qwen-3-235b-a22b-instruct-2507");
    expect(resolveModel("level3")).toBe("qwen-3-235b-a22b-instruct-2507");
  });

  it("lets a level-specific model override the shared smart model", () => {
    process.env.SMART_LLM_MODEL = "shared-smart";
    process.env.LEVEL3_LLM_MODEL = "level3-only";

    expect(resolveModel("level3")).toBe("level3-only");
  });

  it("adds default smart fallbacks without duplicating the primary model", () => {
    process.env.SMART_LLM_MODEL = "qwen-3-235b-a22b-instruct-2507";
    delete process.env.SMART_LLM_FALLBACK_MODELS;
    delete process.env.LEVEL3_LLM_FALLBACK_MODELS;

    expect(resolveModelCandidates("level3")).toEqual(["qwen-3-235b-a22b-instruct-2507", "zai-glm-4.7", "gpt-oss-120b"]);
  });

  it("honors level-specific fallback model order", () => {
    process.env.LEVEL3_LLM_MODEL = "primary";
    process.env.LEVEL3_LLM_FALLBACK_MODELS = "fallback-a, fallback-b";

    expect(resolveModelCandidates("level3")).toEqual(["primary", "fallback-a", "fallback-b"]);
  });

  it("uses OpenAI credentials and base URL when the provider is explicitly OpenAI", () => {
    process.env.LEVEL3_LLM_PROVIDER = "openai";
    process.env.CEREBRAS_API_KEY = "cerebras-key";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.LLM_BASE_URL = "https://api.cerebras.ai/v1";
    delete process.env.OPENAI_API_BASE;
    delete process.env.CEREBRAS_API_BASE;

    const config = resolveLlmConfig("level3");

    expect(config?.provider).toBe("openai");
    expect(config?.apiKey).toBe("openai-key");
    expect(config?.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("treats Anthropic as a first-class configured provider", () => {
    process.env.LEVEL3_LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.LLM_BASE_URL = "https://api.cerebras.ai/v1";
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.ANTHROPIC_API_BASE;

    const config = resolveLlmConfig("level3");

    expect(hasLlmConfig()).toBe(true);
    expect(config?.provider).toBe("anthropic");
    expect(config?.apiKey).toBe("anthropic-key");
    expect(config?.baseUrl).toBe("https://api.anthropic.com");
  });

  it("fails preflight before a timed run when an explicit provider is missing credentials", () => {
    process.env.LEVEL3_LLM_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_API_KEY;

    expect(() => requireLlmConfig("level3")).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("treats Codex CLI as a configured GPT-5.5 provider without API keys", () => {
    process.env.LEVEL3_LLM_PROVIDER = "codex-cli";
    delete process.env.LEVEL3_LLM_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.LLM_API_KEY;

    expect(hasLlmConfig()).toBe(true);
    expect(requireLlmConfig("level3")).toBeUndefined();
    expect(resolveModel("level3")).toBe("gpt-5.5");
    expect(resolveModelCandidates("level3")).toEqual(["gpt-5.5"]);
  });
});

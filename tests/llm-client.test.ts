import { afterEach, describe, expect, it } from "vitest";

import { resolveModel, resolveModelCandidates } from "../src/llm/client.js";

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
});

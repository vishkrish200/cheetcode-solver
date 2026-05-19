export type LlmPurpose = "level1" | "level2" | "level3";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export interface LlmRequestOptions {
  purpose: LlmPurpose;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  responseFormat?: { type: "json_object" };
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
}

const FAST_DEFAULT_MODEL = "gpt-oss-120b";
const SMART_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";

export function hasLlmConfig(): boolean {
  return Boolean(process.env.CEREBRAS_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
}

export function resolveLlmConfig(purpose: LlmPurpose): LlmConfig | undefined {
  const apiKey = process.env.CEREBRAS_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) return undefined;

  return {
    apiKey,
    baseUrl: process.env.LLM_BASE_URL ?? process.env.CEREBRAS_API_BASE ?? "https://api.cerebras.ai/v1",
    models: resolveModelCandidates(purpose)
  };
}

export async function requestChatCompletion(options: LlmRequestOptions): Promise<{
  content?: string;
  model: string;
}> {
  const config = resolveLlmConfig(options.purpose);
  if (!config) return { model: resolveModel(options.purpose) };

  let lastError: string | undefined;
  for (const model of config.models) {
    const attempts = Number(process.env.LLM_RETRY_ATTEMPTS ?? 2);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await fetch(new URL("chat/completions", ensureTrailingSlash(config.baseUrl)), {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          response_format: options.responseFormat ?? { type: "json_object" },
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens,
          messages: options.messages
        })
      });

      const text = await response.text();
      if (response.ok) {
        const completion = JSON.parse(text) as ChatCompletionResponse;
        return {
          content: completion.choices?.[0]?.message?.content,
          model
        };
      }

      lastError = `LLM request failed ${response.status} on ${model}: ${text.slice(0, 1000)}`;
      if (!isRetryableStatus(response.status) || attempt === attempts) break;
      await delay(Number(process.env.LLM_RETRY_DELAY_MS ?? 750) * attempt);
    }
  }

  throw new Error(lastError ?? "LLM request failed.");
}

export function resolveModel(purpose: LlmPurpose): string {
  const levelSpecific = process.env[`${purpose.toUpperCase()}_LLM_MODEL`];
  if (levelSpecific) return levelSpecific;

  if (purpose === "level1") {
    return process.env.LLM_MODEL ?? process.env.CEREBRAS_MODEL ?? FAST_DEFAULT_MODEL;
  }

  return process.env.SMART_LLM_MODEL ?? process.env.LLM_MODEL ?? process.env.CEREBRAS_MODEL ?? SMART_DEFAULT_MODEL;
}

export function resolveModelCandidates(purpose: LlmPurpose): string[] {
  const primary = resolveModel(purpose);
  const rawFallbacks =
    process.env[`${purpose.toUpperCase()}_LLM_FALLBACK_MODELS`] ??
    (purpose === "level1" ? process.env.LLM_FALLBACK_MODELS : process.env.SMART_LLM_FALLBACK_MODELS);
  const configured = rawFallbacks
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const defaults = purpose === "level1" ? [] : ["zai-glm-4.7", "gpt-oss-120b"];
  return unique([primary, ...(configured ?? defaults)]);
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

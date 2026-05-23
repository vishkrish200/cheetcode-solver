import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
  modelCandidates?: string[];
}

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export type LlmProvider = "openai-compatible" | "cerebras" | "openai" | "anthropic" | "vertex" | "codex-cli";

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

interface VertexGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
    status?: string;
  };
}

const FAST_DEFAULT_MODEL = "gpt-oss-120b";
const SMART_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";
const VERTEX_DEFAULT_MODEL = "gemini-3.5-flash";
const CODEX_CLI_DEFAULT_MODEL = "gpt-5.5";

const execFileAsync = promisify(execFile);

export function hasLlmConfig(): boolean {
  const provider = resolveLlmProvider("level3");
  return Boolean(provider === "vertex" || provider === "codex-cli" || resolveLlmConfig("level3"));
}

export function resolveLlmConfig(purpose: LlmPurpose): LlmConfig | undefined {
  const provider = resolveLlmProvider(purpose);
  if (provider === "vertex" || provider === "codex-cli") return undefined;

  const apiKey = resolveApiKey(provider);
  if (!apiKey) return undefined;

  return {
    provider,
    apiKey,
    baseUrl: resolveBaseUrl(provider, purpose),
    models: resolveModelCandidates(purpose)
  };
}

export function requireLlmConfig(purpose: LlmPurpose): LlmConfig | undefined {
  const provider = resolveLlmProvider(purpose);
  if (provider === "vertex" || provider === "codex-cli") return undefined;

  const config = resolveLlmConfig(purpose);
  if (config) return config;

  throw new Error(`Missing LLM credentials for ${provider}. Set ${credentialHint(provider)} before starting a timed run.`);
}

export async function requestChatCompletion(options: LlmRequestOptions): Promise<{
  content?: string;
  model: string;
}> {
  const provider = resolveLlmProvider(options.purpose);
  if (provider === "vertex") {
    return requestVertexCompletion(options);
  }
  if (provider === "anthropic") {
    return requestAnthropicCompletion(options);
  }
  if (provider === "codex-cli") {
    return requestCodexCliCompletion(options);
  }

  return requestOpenAiCompatibleCompletion(options);
}

async function requestOpenAiCompatibleCompletion(options: LlmRequestOptions): Promise<{
  content?: string;
  model: string;
}> {
  const config = resolveLlmConfig(options.purpose);
  if (!config) return { model: resolveModel(options.purpose) };

  let lastError: string | undefined;
  for (const model of resolveRequestModelCandidates(options, config.models)) {
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

  const provider = resolveLlmProvider(purpose);
  if (provider === "vertex") {
    return process.env[`${purpose.toUpperCase()}_VERTEX_MODEL`] ?? process.env.VERTEX_MODEL ?? VERTEX_DEFAULT_MODEL;
  }
  if (provider === "codex-cli") {
    return (
      process.env[`${purpose.toUpperCase()}_CODEX_CLI_MODEL`] ??
      process.env.CODEX_CLI_MODEL ??
      CODEX_CLI_DEFAULT_MODEL
    );
  }
  if (provider === "openai") {
    return process.env[`${purpose.toUpperCase()}_OPENAI_MODEL`] ?? process.env.OPENAI_MODEL ?? defaultModelForPurpose(purpose);
  }
  if (provider === "anthropic") {
    return (
      process.env[`${purpose.toUpperCase()}_ANTHROPIC_MODEL`] ??
      process.env.ANTHROPIC_MODEL ??
      defaultModelForPurpose(purpose)
    );
  }

  if (purpose === "level1") {
    return process.env.LLM_MODEL ?? process.env.CEREBRAS_MODEL ?? FAST_DEFAULT_MODEL;
  }

  return process.env.SMART_LLM_MODEL ?? process.env.LLM_MODEL ?? process.env.CEREBRAS_MODEL ?? SMART_DEFAULT_MODEL;
}

export function resolveModelCandidates(purpose: LlmPurpose): string[] {
  const primary = resolveModel(purpose);
  const provider = resolveLlmProvider(purpose);
  const rawFallbacks = resolveFallbackModelsEnv(provider, purpose);
  const configured = rawFallbacks
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const defaults =
    purpose === "level1" || provider === "vertex" || provider === "openai" || provider === "anthropic"
    || provider === "codex-cli"
      ? []
      : ["zai-glm-4.7", "gpt-oss-120b"];
  return unique([primary, ...(configured ?? defaults)]);
}

export function resolveLlmProvider(purpose: LlmPurpose): LlmProvider {
  const value = process.env[`${purpose.toUpperCase()}_LLM_PROVIDER`] ?? process.env.LLM_PROVIDER;
  const normalized = value?.toLowerCase();
  if (
    normalized === "vertex" ||
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "cerebras" ||
    normalized === "codex-cli" ||
    normalized === "openai-compatible"
  ) {
    return normalized;
  }
  return "openai-compatible";
}

function resolveApiKey(provider: LlmProvider): string | undefined {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY;
    case "cerebras":
      return process.env.CEREBRAS_API_KEY ?? process.env.LLM_API_KEY;
    case "openai-compatible":
      return process.env.CEREBRAS_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
    case "codex-cli":
      return undefined;
    case "vertex":
      return undefined;
  }
}

function credentialHint(provider: LlmProvider): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openai-compatible":
      return "CEREBRAS_API_KEY, OPENAI_API_KEY, or LLM_API_KEY";
    case "codex-cli":
      return "Codex CLI login";
    case "vertex":
      return "Vertex gcloud credentials";
  }
}

function resolveBaseUrl(provider: LlmProvider, purpose: LlmPurpose): string {
  const levelBaseUrl = process.env[`${purpose.toUpperCase()}_LLM_BASE_URL`];
  switch (provider) {
    case "openai":
      return levelBaseUrl ?? process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
    case "anthropic":
      return levelBaseUrl ?? process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
    case "cerebras":
      return levelBaseUrl ?? process.env.CEREBRAS_API_BASE ?? process.env.LLM_BASE_URL ?? "https://api.cerebras.ai/v1";
    case "openai-compatible":
      return levelBaseUrl ?? process.env.LLM_BASE_URL ?? process.env.CEREBRAS_API_BASE ?? "https://api.cerebras.ai/v1";
    case "codex-cli":
      return "";
    case "vertex":
      return "";
  }
}

function resolveFallbackModelsEnv(provider: LlmProvider, purpose: LlmPurpose): string | undefined {
  const prefix = purpose.toUpperCase();
  if (provider === "vertex") {
    return (
      process.env[`${prefix}_LLM_FALLBACK_MODELS`] ??
      process.env[`${prefix}_VERTEX_FALLBACK_MODELS`] ??
      process.env.VERTEX_FALLBACK_MODELS
    );
  }
  if (provider === "openai") {
    return (
      process.env[`${prefix}_LLM_FALLBACK_MODELS`] ??
      process.env[`${prefix}_OPENAI_FALLBACK_MODELS`] ??
      process.env.OPENAI_FALLBACK_MODELS
    );
  }
  if (provider === "anthropic") {
    return (
      process.env[`${prefix}_LLM_FALLBACK_MODELS`] ??
      process.env[`${prefix}_ANTHROPIC_FALLBACK_MODELS`] ??
      process.env.ANTHROPIC_FALLBACK_MODELS
    );
  }
  if (provider === "codex-cli") {
    return (
      process.env[`${prefix}_LLM_FALLBACK_MODELS`] ??
      process.env[`${prefix}_CODEX_CLI_FALLBACK_MODELS`] ??
      process.env.CODEX_CLI_FALLBACK_MODELS
    );
  }
  return (
    process.env[`${prefix}_LLM_FALLBACK_MODELS`] ??
    (purpose === "level1" ? process.env.LLM_FALLBACK_MODELS : process.env.SMART_LLM_FALLBACK_MODELS)
  );
}

async function requestCodexCliCompletion(options: LlmRequestOptions): Promise<{ content?: string; model: string }> {
  const models = resolveRequestModelCandidates(options, resolveModelCandidates(options.purpose));
  let lastError: string | undefined;

  for (const model of models) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cheetcode-codex-cli-"));
    const outputPath = path.join(tempDir, "last-message.txt");
    const schemaPath = path.join(tempDir, "schema.json");
    const prompt = buildCodexCliPrompt(options);
    try {
      if (options.responseFormat?.type === "json_object") {
        await fs.writeFile(schemaPath, JSON.stringify(buildCodexCliOutputSchema(options)));
      }
      const result = await runCodexCli(
        model,
        prompt,
        outputPath,
        options.responseFormat?.type === "json_object" ? schemaPath : undefined
      );
      const content = await fs.readFile(outputPath, "utf8").catch(() => "");
      const finalContent = content.trim() || extractCodexCliAgentMessage(result.stdout);
      if (result.exitCode === 0) {
        if (finalContent) return { content: finalContent, model };
        lastError = `Codex CLI returned no final message on ${model}: ${tail(
          [result.stderr, result.stdout].filter(Boolean).join("\n"),
          2000
        )}`;
        continue;
      }
      lastError = `Codex CLI failed on ${model} with exit ${result.exitCode}: ${tail(
        [result.stderr, result.stdout].filter(Boolean).join("\n"),
        2000
      )}`;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  throw new Error(lastError ?? "Codex CLI request failed.");
}

function buildCodexCliPrompt(options: LlmRequestOptions): string {
  const responseInstruction =
    options.responseFormat?.type === "json_object"
      ? "Your final answer must be exactly one valid JSON object that satisfies the schema. Do not include markdown, commentary, status sentences, shell commands, or file edits."
      : "Return only the final answer. Do not include markdown unless explicitly requested.";
  const messages = options.messages
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join("\n\n");
  return [
    "You are being used as a non-interactive completion backend for a timed coding challenge.",
    "Do not inspect the repository, do not run commands, and do not modify files.",
    "Do not describe what you are doing. Produce the requested final artifact directly.",
    responseInstruction,
    messages
  ].join("\n\n");
}

function buildCodexCliOutputSchema(options: LlmRequestOptions): Record<string, unknown> {
  const text = options.messages.map((message) => message.content).join("\n");
  if (/one key,\s*code|key,\s*code|\"code\"/i.test(text)) {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string" }
      },
      required: ["code"]
    };
  }
  if (/one key,\s*contract|key,\s*contract|\"contract\"/i.test(text)) {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        contract: { type: "string" }
      },
      required: ["contract"]
    };
  }
  return {
    type: "object",
    additionalProperties: true
  };
}

async function runCodexCli(
  model: string,
  prompt: string,
  outputPath: string,
  schemaPath?: string
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const args = ["-a", "never"];
  const reasoningEffort = process.env.CODEX_CLI_REASONING_EFFORT ?? "low";
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }
  const serviceTier = process.env.CODEX_CLI_SERVICE_TIER ?? "priority";
  if (serviceTier) {
    args.push("-c", `model_service_tier="${serviceTier}"`);
  }

  args.push(
    "exec",
    "-m",
    model,
    "--sandbox",
    process.env.CODEX_CLI_SANDBOX ?? "read-only",
    "--cd",
    process.env.CODEX_CLI_CWD ?? process.cwd(),
    "--output-last-message",
    outputPath,
    "--json",
    "--ephemeral",
    "--ignore-rules",
    "-"
  );
  if (schemaPath) {
    args.splice(args.indexOf("--json"), 0, "--output-schema", schemaPath);
  }
  if (process.env.CODEX_CLI_IGNORE_USER_CONFIG !== "0") {
    args.splice(args.indexOf("--ignore-rules"), 0, "--ignore-user-config");
  }

  const timeoutMs = Number(process.env.CODEX_CLI_TIMEOUT_MS ?? 90000);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CODEX_CLI_BIN ?? "codex", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = tail(stdout + chunk.toString("utf8"), 200_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString("utf8"), 200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin.end(prompt);
  });
}

function extractCodexCliAgentMessage(stdout: string): string | undefined {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        return event.item.text.trim();
      }
    } catch {
      // Ignore non-JSON warning lines from the CLI.
    }
  }
  return undefined;
}

function defaultModelForPurpose(purpose: LlmPurpose): string {
  return purpose === "level1" ? process.env.LLM_MODEL ?? FAST_DEFAULT_MODEL : process.env.SMART_LLM_MODEL ?? SMART_DEFAULT_MODEL;
}

function resolveRequestModelCandidates(options: LlmRequestOptions, defaults: string[]): string[] {
  return options.modelCandidates?.length ? unique(options.modelCandidates) : defaults;
}

async function requestAnthropicCompletion(options: LlmRequestOptions): Promise<{ content?: string; model: string }> {
  const config = resolveLlmConfig(options.purpose);
  if (!config) return { model: resolveModel(options.purpose) };

  let lastError: string | undefined;
  for (const model of resolveRequestModelCandidates(options, config.models)) {
    const attempts = Number(process.env.LLM_RETRY_ATTEMPTS ?? 2);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await fetch(anthropicMessagesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify(buildAnthropicMessagesBody(options, model))
      });

      const text = await response.text();
      if (response.ok) {
        const completion = JSON.parse(text) as AnthropicMessagesResponse;
        return {
          content: extractAnthropicText(completion),
          model
        };
      }

      lastError = `Anthropic request failed ${response.status} on ${model}: ${text.slice(0, 1000)}`;
      if (!isRetryableStatus(response.status) || attempt === attempts) break;
      await delay(Number(process.env.LLM_RETRY_DELAY_MS ?? 750) * attempt);
    }
  }

  throw new Error(lastError ?? "Anthropic request failed.");
}

function buildAnthropicMessagesBody(options: LlmRequestOptions, model: string): Record<string, unknown> {
  const systemTexts = options.messages.filter((message) => message.role === "system").map((message) => message.content);
  if (options.responseFormat?.type === "json_object") {
    systemTexts.push("Return strictly valid JSON. Do not wrap it in markdown or explanatory prose.");
  }

  return {
    model,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0,
    ...(systemTexts.length > 0 ? { system: systemTexts.join("\n\n") } : {}),
    messages: options.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content
      }))
  };
}

function anthropicMessagesUrl(baseUrl: string): URL {
  const base = ensureTrailingSlash(baseUrl);
  return new URL(base.endsWith("/v1/") ? "messages" : "v1/messages", base);
}

function extractAnthropicText(response: AnthropicMessagesResponse): string | undefined {
  const texts = response.content
    ?.map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return texts?.join("") || undefined;
}

async function requestVertexCompletion(options: LlmRequestOptions): Promise<{ content?: string; model: string }> {
  const models = resolveRequestModelCandidates(options, resolveModelCandidates(options.purpose));
  const accessToken = await resolveVertexAccessToken();
  let lastError: string | undefined;

  for (const model of models) {
    const attempts = Number(process.env.LLM_RETRY_ATTEMPTS ?? 2);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await fetch(vertexGenerateContentUrl(model), {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(buildVertexGenerateContentBody(options))
      });

      const text = await response.text();
      if (response.ok) {
        const completion = JSON.parse(text) as VertexGenerateContentResponse;
        return {
          content: extractVertexText(completion),
          model
        };
      }

      lastError = `Vertex request failed ${response.status} on ${model}: ${text.slice(0, 1000)}`;
      if (!isRetryableStatus(response.status) || attempt === attempts) break;
      await delay(Number(process.env.LLM_RETRY_DELAY_MS ?? 750) * attempt);
    }
  }

  throw new Error(lastError ?? "Vertex request failed.");
}

function buildVertexGenerateContentBody(options: LlmRequestOptions): Record<string, unknown> {
  const systemTexts = options.messages.filter((message) => message.role === "system").map((message) => message.content);
  const contents = options.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));

  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0,
    maxOutputTokens: options.maxTokens
  };
  if (options.responseFormat?.type === "json_object") {
    generationConfig.responseMimeType = "application/json";
  }

  const thinkingLevel =
    process.env[`${options.purpose.toUpperCase()}_VERTEX_THINKING_LEVEL`] ?? process.env.VERTEX_THINKING_LEVEL;
  if (thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  return {
    ...(systemTexts.length > 0 ? { systemInstruction: { parts: systemTexts.map((text) => ({ text })) } } : {}),
    contents,
    generationConfig
  };
}

function vertexGenerateContentUrl(model: string): string {
  const project = process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (!project) {
    throw new Error("Set VERTEX_PROJECT or GOOGLE_CLOUD_PROJECT for Vertex Gemini.");
  }

  const location = process.env.VERTEX_LOCATION ?? "global";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(
    location
  )}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

async function resolveVertexAccessToken(): Promise<string> {
  if (process.env.VERTEX_ACCESS_TOKEN) return process.env.VERTEX_ACCESS_TOKEN;

  const args = ["auth", "print-access-token"];
  const account = process.env.VERTEX_GCLOUD_ACCOUNT;
  if (account) args.push("--account", account);

  const { stdout } = await execFileAsync("gcloud", args, { maxBuffer: 1024 * 1024 });
  const token = stdout.trim();
  if (!token) throw new Error("gcloud auth print-access-token returned an empty token.");
  return token;
}

function extractVertexText(response: VertexGenerateContentResponse): string | undefined {
  const firstCandidate = response.candidates?.[0];
  const texts = firstCandidate?.content?.parts
    ?.map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return texts?.join("") || undefined;
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

function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(-maxLength) : value;
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

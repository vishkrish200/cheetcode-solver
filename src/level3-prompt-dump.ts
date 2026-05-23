import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadEnvFile } from "./env.js";
import {
  buildLevel3ContractLlmRequest,
  buildLevel3ImplementationLlmRequest,
  buildLevel3LlmRequest
} from "./level3/llm.js";
import type { Level3Challenge, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import { resolveModelCandidates } from "./llm/client.js";

loadEnvFile();

interface PromptDump {
  generatedAt: string;
  sourceRunDir: string;
  modelCandidates: string[];
  httpBody: {
    model: string;
    response_format: { type: "json_object" };
    temperature: number;
    max_tokens: number;
    messages: ReturnType<typeof buildLevel3LlmRequest>["messages"];
  };
  requestOptions: ReturnType<typeof buildLevel3LlmRequest>;
  parsedUserMessage: unknown;
}

async function main(): Promise<void> {
  const runDir = process.argv[2];
  if (!runDir) {
    throw new Error("Usage: npx tsx src/level3-prompt-dump.ts <level3-run-dir>");
  }

  const absoluteRunDir = resolve(runDir);
  const session = JSON.parse(await readFile(join(absoluteRunDir, "session.json"), "utf8")) as Level3Session;
  const challenge = firstChallenge(session);

  const contract = buildDump(absoluteRunDir, buildLevel3ContractLlmRequest(challenge));
  await writeFile(join(absoluteRunDir, "llm-prompt-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);

  const initial = buildDump(
    absoluteRunDir,
    buildLevel3ImplementationLlmRequest(challenge, {}, {}, "PLACEHOLDER: first-stage contract text is generated live.")
  );
  await writeFile(join(absoluteRunDir, "llm-prompt-initial.json"), `${JSON.stringify(initial, null, 2)}\n`);

  const validation = await readOptionalJson<Level3ValidationResponse>(join(absoluteRunDir, "validation.json"));
  const previousCode = await readOptionalText(join(absoluteRunDir, codeFileName(challenge.language)));
  if (validation && previousCode) {
    const repair = buildDump(
      absoluteRunDir,
      buildLevel3LlmRequest(challenge, {
        previousCode,
        validation
      })
    );
    await writeFile(
      join(absoluteRunDir, "llm-prompt-repair-after-validation.json"),
      `${JSON.stringify(repair, null, 2)}\n`
    );
  }

  console.log(join(absoluteRunDir, "llm-prompt-contract.json"));
  console.log(join(absoluteRunDir, "llm-prompt-initial.json"));
  if (validation && previousCode) {
    console.log(join(absoluteRunDir, "llm-prompt-repair-after-validation.json"));
  }
}

function firstChallenge(session: Level3Session): Level3Challenge {
  const challenge = session.problems?.[0];
  if (!challenge) throw new Error("session.json does not contain a Level 3 challenge.");
  return challenge;
}

function buildDump(runDir: string, requestOptions: ReturnType<typeof buildLevel3LlmRequest>): PromptDump {
  const modelCandidates = resolveModelCandidates(requestOptions.purpose);
  const selectedModel = modelCandidates[0] ?? "unknown";
  return {
    generatedAt: new Date().toISOString(),
    sourceRunDir: runDir,
    modelCandidates,
    httpBody: {
      model: selectedModel,
      response_format: requestOptions.responseFormat ?? { type: "json_object" },
      temperature: requestOptions.temperature ?? 0,
      max_tokens: requestOptions.maxTokens,
      messages: requestOptions.messages
    },
    requestOptions,
    parsedUserMessage: JSON.parse(requestOptions.messages[1]?.content ?? "{}")
  };
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  const text = await readOptionalText(filePath);
  return text ? (JSON.parse(text) as T) : undefined;
}

function codeFileName(language: string): string {
  if (language === "Rust") return "code.rs";
  if (language === "C") return "code.c";
  return "code.cpp";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

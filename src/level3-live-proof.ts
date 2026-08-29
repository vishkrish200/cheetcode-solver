import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { allLevel3ChecksPassed, createLevel3Client } from "./level3/api.js";
import { buildLevel3LlmRequest } from "./level3/llm.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import type { Level3Session } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { resolveGithubIdentity } from "./identity.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

const command = process.argv[2] ?? "help";

async function main(): Promise<void> {
  if (command === "start") {
    await startLiveProof();
    return;
  }

  if (command === "submit") {
    const runDir = process.argv[3];
    const codePath = process.argv[4];
    if (!runDir || !codePath) throw new Error("Usage: npm run level3:live-proof -- submit <run-dir> <code-file>");
    await submitLiveProof(path.resolve(runDir), path.resolve(codePath));
    return;
  }

  printHelp();
}

async function startLiveProof(): Promise<void> {
  const client = await createLevel3Client();
  const runDir = await createRunDir("level3-live-proof");
  const preview = await client.preview();
  await writeJson(path.join(runDir, "preview.json"), preview);
  const session = await client.startSession(preview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) throw new Error("Level 3 session did not include a challenge.");

  const prompt = buildLevel3LlmRequest(challenge);
  await writeJson(path.join(runDir, "llm-prompt-initial.json"), {
    httpBody: {
      response_format: prompt.responseFormat ?? { type: "json_object" },
      temperature: prompt.temperature ?? 0,
      max_tokens: prompt.maxTokens,
      messages: prompt.messages
    },
    requestOptions: prompt,
    parsedUserMessage: JSON.parse(prompt.messages[1]?.content ?? "{}")
  });

  console.log(`runDir=${runDir}`);
  console.log(`task=${challenge.taskName}`);
  console.log(`language=${challenge.language}`);
  console.log(`expiresAt=${new Date(session.expiresAt).toISOString()}`);
  console.log(`prompt=${path.join(runDir, "llm-prompt-initial.json")}`);
}

async function submitLiveProof(runDir: string, codePath: string): Promise<void> {
  const client = await createLevel3Client();
  const session = JSON.parse(await fs.readFile(path.join(runDir, "session.json"), "utf8")) as Level3Session;
  const challenge = session.problems[0];
  if (!challenge) throw new Error("Level 3 session did not include a challenge.");

  const code = await fs.readFile(codePath, "utf8");
  const ext = sourceExtension(challenge.language);
  await fs.copyFile(codePath, path.join(runDir, `submitted-live-proof.${ext}`));

  const localCompile = await compileLevel3Source(runDir, "live-proof", challenge.language, code);
  await writeJson(path.join(runDir, "local-compile-live-proof.json"), localCompile);
  if (!localCompile.ok) {
    console.log(`Local compile failed. Artifacts: ${runDir}`);
    return;
  }

  const validation = await client.validateCode(session.sessionId, challenge.id, code);
  await writeJson(path.join(runDir, "validation-live-proof.json"), validation);

    const finish = await client.finishSession(session, code, resolveGithubIdentity()).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error)
  }));
  await writeJson(path.join(runDir, "finish-live-proof.json"), finish);

  const passCount =
    typeof validation.passCount === "number"
      ? validation.passCount
      : validation.results.filter((result) => result.correct).length;
  const passed = allLevel3ChecksPassed(validation, challenge.checks.length);
  console.log(
    `Live proof ${passed ? "passed" : "failed"}: compiled=${validation.compiled !== false}, pass=${passCount}/${
      challenge.checks.length
    }`
  );
  console.log(`Artifacts: ${runDir}`);
}

function printHelp(): void {
  console.log(`Usage:
  npm run level3:live-proof -- start
  npm run level3:live-proof -- submit <run-dir> <code-file>
`);
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

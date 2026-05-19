import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { createLevel3Client, allLevel3ChecksPassed } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { solveLevel3WithLlm } from "./level3/llm.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import { solveTraitExpressionTask } from "./level3/specialists/trait-expression.js";
import type { Level3Challenge, Level3ValidationResponse } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { OUTPUT_ROOT, createRunDir } from "./recon/capture.js";

loadEnvFile();

const command = process.argv[2] ?? "run";

async function main(): Promise<void> {
  switch (command) {
    case "preview":
      await previewLevel3();
      return;
    case "run":
      await runLevel3();
      return;
    case "catalog":
      await catalogLevel3();
      return;
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown level3 command: ${command}`);
  }
}

async function catalogLevel3(): Promise<void> {
  const samples = Number(process.env.LEVEL3_CATALOG_SAMPLES ?? 12);
  const runDir = await createRunDir("level3-catalog");
  const client = await createLevel3Client();
  const previews = [];

  for (let index = 0; index < samples; index += 1) {
    const preview = await client.preview();
    previews.push(preview);
    console.log(`${String(index + 1).padStart(2, "0")}. ${preview.taskName} in ${preview.language}`);
  }

  await writeJson(path.join(runDir, "previews.json"), previews);
  const counts: Record<string, number> = {};
  for (const preview of previews) {
    const key = `${preview.taskName} [${preview.language}]`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  await writeJson(path.join(runDir, "summary.json"), counts);
  console.log(`Level 3 catalog artifacts: ${runDir}`);
}

async function previewLevel3(): Promise<void> {
  const runDir = await createRunDir("level3-preview");
  const client = await createLevel3Client();
  const preview = process.env.LEVEL3_PREVIEW_TOKEN
    ? {
        challengeId: process.env.LEVEL3_CHALLENGE_ID ?? "pinned",
        taskName: process.env.LEVEL3_TASK_NAME ?? "pinned",
        language: process.env.LEVEL3_LANGUAGE ?? "unknown",
        previewToken: process.env.LEVEL3_PREVIEW_TOKEN
      }
    : await client.preview();
  await writeJson(path.join(runDir, "preview.json"), preview);

  console.log(`Level 3 preview artifacts: ${runDir}`);
  console.log(`${preview.taskName} in ${preview.language}`);
  console.log(`challengeId: ${preview.challengeId}`);
  console.log(`previewToken: ${preview.previewToken}`);
}

async function runLevel3(): Promise<void> {
  const github = process.env.CHEETCODE_GITHUB ?? "trimax-eng";
  const runDir = await createRunDir("level3-attempt");
  const startedAt = Date.now();
  const solverMode = parseSolverMode(process.env.LEVEL3_SOLVER_MODE ?? "dynamic");

  const client = await createLevel3Client();
  const preview = await client.preview();
  await writeJson(path.join(runDir, "preview.json"), preview);

  const session = await client.startSession(preview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) {
    throw new Error("Level 3 session did not include a challenge payload.");
  }

  let code = await loadInitialCode(challenge);
  await fs.writeFile(path.join(runDir, `attempt-00.${sourceExtension(challenge.language)}`), code);

  const maxAttempts = Number(process.env.LEVEL3_MAX_ATTEMPTS ?? 4);
  let validation: Level3ValidationResponse | undefined;
  let solved = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const localCompile = await compileLevel3Source(runDir, String(attempt).padStart(2, "0"), challenge.language, code);
    await writeJson(path.join(runDir, `local-compile-${String(attempt).padStart(2, "0")}.json`), localCompile);
    if (!localCompile.ok) {
      console.warn(`Level 3 local compile ${attempt}: failed before server validation`);
      validation = {
        compiled: false,
        error: localCompile.error ?? "local compile failed",
        results: challenge.checks.map((check) => ({ problemId: check.id, correct: false, name: check.name }))
      };
      if (attempt === maxAttempts) break;
      const repaired = await solveLevel3WithLlm(challenge, { previousCode: code, validation });
      if (!repaired?.trim()) {
        throw new Error("LLM did not return repair code for Level 3.");
      }
      code = repaired;
      await fs.writeFile(path.join(runDir, `attempt-${String(attempt).padStart(2, "0")}.${sourceExtension(challenge.language)}`), code);
      continue;
    }

    validation = await client.validateCode(session.sessionId, challenge.id, code);
    await writeJson(path.join(runDir, `validation-${String(attempt).padStart(2, "0")}.json`), validation);

    solved = allLevel3ChecksPassed(validation, challenge.checks.length);
    console.log(
      `Level 3 validation ${attempt}: ${
        validation.compiled === false ? "compile failed" : validation.results.filter((result) => result.correct).length
      }/${challenge.checks.length} checks`
    );
    if (solved) break;
    if (attempt === maxAttempts) break;

    const repaired = await solveLevel3WithLlm(challenge, { previousCode: code, validation });
    if (!repaired?.trim()) {
      throw new Error("LLM did not return repair code for Level 3.");
    }
    code = repaired;
    await fs.writeFile(path.join(runDir, `attempt-${String(attempt).padStart(2, "0")}.${sourceExtension(challenge.language)}`), code);
  }

  if (!solved && process.env.LEVEL3_FINISH_UNSOLVED !== "1") {
    throw new Error(`Level 3 did not pass all checks after ${maxAttempts} attempt(s). Artifacts: ${runDir}`);
  }

  const timeElapsed = Math.max(0, Date.now() - (session.startedAt ?? startedAt));
  const result = await client.finishSession(session, code, github, timeElapsed);
  const finishedAt = Date.now();

  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level3",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    solverMode,
    challenge: {
      id: challenge.id,
      taskName: challenge.taskName,
      language: challenge.language,
      checks: challenge.checks
    },
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    validation,
    solvedBeforeFinish: solved
  });

  console.log(`Level 3 attempt artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, unlocked=${result.progress?.unlockedLevel}`
  );
}

async function loadInitialCode(challenge: Level3Challenge): Promise<string> {
  const codeFile = process.env.LEVEL3_CODE_FILE;
  if (codeFile) return fs.readFile(path.resolve(codeFile), "utf8");

  const solverMode = parseSolverMode(process.env.LEVEL3_SOLVER_MODE ?? "dynamic");
  if (solverMode === "hybrid" || solverMode === "candidate") {
    const candidate = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
    if (candidate?.trim()) return candidate;
    if (solverMode === "candidate") {
      throw new Error(`No candidate code registered for ${challenge.taskName} [${challenge.language}].`);
    }
  }

  if (solverMode === "specialist" || solverMode === "hybrid") {
    const specialist = solveTraitExpressionTask(challenge.taskName, challenge.language);
    if (specialist) return specialist;
  }

  const code = await solveLevel3WithLlm(challenge);
  if (code?.trim()) return code;

  if (solverMode === "hybrid") {
    const specialist = solveTraitExpressionTask(challenge.taskName, challenge.language);
    if (specialist) return specialist;
  }

  if (challenge.starterCode?.trim()) return challenge.starterCode;
  throw new Error("No LEVEL3_CODE_FILE, no LLM code, and no starter code were available.");
}

type Level3SolverMode = "dynamic" | "hybrid" | "specialist" | "candidate";

function parseSolverMode(value: string): Level3SolverMode {
  if (value === "dynamic" || value === "hybrid" || value === "specialist" || value === "candidate") return value;
  throw new Error(`Invalid LEVEL3_SOLVER_MODE '${value}'. Expected dynamic, hybrid, specialist, or candidate.`);
}

function printHelp(): void {
  console.log(`Usage:
  npm run level3:preview   Safely fetch current Level 3 prereq preview. Does not start timer.
  npm run level3 -- catalog Catalog random Level 3 preview assignments. Does not start timer.
  npm run level3           Start Level 3, ask LLM for code, validate, finish.

Environment:
	  CHEETCODE_GITHUB          Default: trimax-eng
	  LEVEL3_CODE_FILE          Submit/validate code from this file instead of asking the LLM
	  LEVEL3_PREVIEW_TOKEN      Reuse a safe-preview token instead of drawing a new random challenge
	  LEVEL3_SOLVER_MODE        dynamic, hybrid, specialist, or candidate. Default: dynamic
	  LEVEL3_LLM_MODEL          Per-level model override
	  SMART_LLM_MODEL           Default strong model for Level 2/3
		  LEVEL3_MAX_ATTEMPTS       Default: 4
		  LEVEL3_LLM_MAX_TOKENS     Default: 8000
		  LEVEL3_MAX_BINARY_BYTES   Default: 134217728
		  LEVEL3_FINISH_UNSOLVED=1  Finish even when validation did not pass all checks
  LEVEL3_CATALOG_SAMPLES    Default for catalog: 12
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

import vm from "node:vm";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { resolveGithubIdentity } from "./identity.js";
import { OUTPUT_ROOT, createRunDir } from "./recon/capture.js";
import { createLevel1Client, writeJson } from "./level1/api.js";
import { hasLlmConfig, solveWithLlm } from "./level1/llm.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { CheetProblem, SolvedProblem } from "./level1/types.js";

loadEnvFile();

async function main(): Promise<void> {
  const github = resolveGithubIdentity();
  const runDir = await createRunDir("level1-attempt");
  const client = await createLevel1Client();
  const startedAt = Date.now();

  const session = await client.startSession();
  await writeJson(path.join(runDir, "session.json"), session);

  const solved = await Promise.all(session.problems.map((problem) => solveAndValidate(problem)));
  await writeJson(path.join(runDir, "submissions.json"), solved);

  const unknown = solved.filter((problem) => !problem.known);
  if (unknown.length > 0) {
    console.warn(`Unknown or sample-failing problems: ${unknown.length}/${solved.length}`);
    for (const problem of unknown) console.warn(`- ${problem.title} | ${problem.signature}`);
  }

  const result = await client.finishSession(session, solved, github);
  const finishedAt = Date.now();
  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level1",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    known: solved.length - unknown.length,
    total: solved.length
  });

  console.log(`Level 1 attempt artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, unlocked=${result.progress?.unlockedLevel}`
  );
}

async function solveAndValidate(problem: CheetProblem): Promise<SolvedProblem> {
  const solved = solveKnownProblem(problem);
  if (!solved.known && hasLlmConfig()) {
    try {
      const llmCode = await solveWithLlm(problem);
      if (llmCode) {
        const llmSolved: SolvedProblem = {
          ...solved,
          known: true,
          source: "llm",
          code: llmCode
        };
        const llmValidation = validateAgainstExamples(llmSolved.code, problem);
        if (llmValidation.ok) return llmSolved;
        solved.validationError = llmValidation.error;
      }
    } catch (error) {
      console.warn(`LLM fallback failed for ${problem.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!solved.known) return solved;

  const validation = validateAgainstExamples(solved.code, problem);
  if (validation.ok) return solved;

  return {
    ...solved,
    known: false,
    source: "starter",
    validationError: validation.error,
    code: problem.starterCode
  };
}

function validateAgainstExamples(code: string, problem: CheetProblem): { ok: boolean; error?: string } {
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!functionName) return { ok: false, error: "Could not parse function name" };

  try {
    const context = vm.createContext({});
    vm.runInContext(`${code}; globalThis.__fn = ${functionName};`, context, { timeout: 1000 });
    const fn = context.__fn as (...args: unknown[]) => unknown;
    for (const testCase of problem.testCases) {
      const actual = fn(...testCase.args);
      if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
        return {
          ok: false,
          error: `Expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`
        };
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

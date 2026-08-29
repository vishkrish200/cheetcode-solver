import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { solveLevel3WithLlmDetailed, type Level3LlmSolveResult } from "./level3/llm.js";
import type { LocalCompileResult } from "./level3/local-compile.js";
import { verifyLevel3Source, type Level3LocalVerificationResult } from "./level3/local-verify.js";
import { shouldRunLevel3LocalSemantics } from "./level3/run-policy.js";
import { parseLevel3SolverMode, shouldUseLevel3RegisteredCandidate } from "./level3/solver-mode.js";
import type { Level3Challenge, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { OUTPUT_ROOT, createRunDir } from "./recon/capture.js";

loadEnvFile();

const sourceArg = process.argv[2] ?? "latest";

interface OfflineSummary {
  sourceSessionPath: string;
  runDir: string;
  taskName: string;
  language: string;
  attempts: number;
  compiled: boolean;
  locallyVerified?: boolean;
  initialCodeSource?: string;
  finalCodePath?: string;
  finalCompile?: LocalCompileResult;
}

async function main(): Promise<void> {
  if (sourceArg === "help") {
    printHelp();
    return;
  }

  const sourceSessionPath = await resolveSourceSessionPath(sourceArg);
  const sourceSession = JSON.parse(await fs.readFile(sourceSessionPath, "utf8")) as Level3Session;
  const challenge = sourceSession.problems[0];
  if (!challenge) throw new Error(`No Level 3 challenge found in ${sourceSessionPath}`);

  const runDir = await createRunDir("level3-offline");
  await writeJson(path.join(runDir, "source-session-path.json"), { sourceSessionPath });
  await writeJson(path.join(runDir, "session.json"), sourceSession);
  await writeJson(path.join(runDir, "challenge.json"), summarizeChallenge(challenge));

  const maxAttempts = Number(process.env.LEVEL3_OFFLINE_MAX_ATTEMPTS ?? process.env.LEVEL3_MAX_ATTEMPTS ?? 6);
  console.log(`Offline Level 3: ${challenge.taskName} [${challenge.language}]`);
  console.log(`Source session: ${sourceSessionPath}`);
  console.log(`Artifacts: ${runDir}`);

  const runLocalSemantics = shouldRunLevel3LocalSemantics(process.env);
  const initial = await loadOfflineInitialCode(challenge);
  let code: string | undefined = initial.code;
  let compileResult: LocalCompileResult | undefined;
  let localVerification: Level3LocalVerificationResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const label = String(attempt).padStart(2, "0");
    const validation = compileResult?.ok === false ? compileFeedback(challenge, compileResult) : undefined;
    if (attempt === 1 && code?.trim()) {
      console.log(`Using ${initial.source} initial code for ${challenge.taskName} [${challenge.language}].`);
    } else {
      const solveResult = await solveLevel3WithLlmDetailed(challenge, {
        previousCode: code,
        validation,
        localVerification
      });
      await writeLevel3OfflineLlmTrace(runDir, label, solveResult);

      code = solveResult.code;
      if (!code?.trim()) throw new Error(`LLM returned no code on offline attempt ${attempt}.`);
    }

    const codePath = path.join(runDir, `attempt-${label}.${sourceExtension(challenge.language)}`);
    await fs.writeFile(codePath, code);

    localVerification = await verifyLevel3Source(runDir, label, challenge, code, {
      skipSemantic: !runLocalSemantics
    });
    compileResult = localVerification.compile;
    await writeJson(path.join(runDir, `local-verify-${label}.json`), localVerification);
    await writeJson(path.join(runDir, `local-compile-${label}.json`), compileResult);

    if (localVerification.ok) {
      const summary: OfflineSummary = {
        sourceSessionPath,
        runDir,
        taskName: challenge.taskName,
        language: challenge.language,
        attempts: attempt,
        compiled: true,
        locallyVerified: runLocalSemantics,
        initialCodeSource: initial.source,
        finalCodePath: codePath,
        finalCompile: compileResult
      };
      await writeJson(path.join(runDir, "summary.json"), summary);
      console.log(`${runLocalSemantics ? "Locally verified" : "Compiled"} after ${attempt} attempt(s): ${codePath}`);
      return;
    }

    if (compileResult.ok && localVerification.semantic && !localVerification.semantic.ok) {
      const passed = localVerification.semantic.checks.filter((check) => check.ok).length;
      const total = localVerification.semantic.checks.length;
      console.warn(`Offline semantic verification ${attempt} failed: ${passed}/${total} local checks`);
    } else {
      console.warn(`Offline compile ${attempt} failed: ${(compileResult.error ?? "unknown error").split(/\r?\n/)[0]}`);
    }
  }

  const summary: OfflineSummary = {
    sourceSessionPath,
    runDir,
    taskName: challenge.taskName,
    language: challenge.language,
    attempts: maxAttempts,
    compiled: false,
    locallyVerified: false,
    initialCodeSource: initial.source,
    finalCompile: compileResult
  };
  await writeJson(path.join(runDir, "summary.json"), summary);
  throw new Error(`Offline Level 3 did not compile after ${maxAttempts} attempt(s). Artifacts: ${runDir}`);
}

async function loadOfflineInitialCode(challenge: Level3Challenge): Promise<{ code?: string; source: string }> {
  const solverMode = parseLevel3SolverMode(process.env.LEVEL3_SOLVER_MODE);
  const useRegistered =
    process.env.LEVEL3_OFFLINE_USE_REGISTERED === "1" || shouldUseLevel3RegisteredCandidate(process.env);
  if (useRegistered) {
    const candidate = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
    if (candidate?.trim()) return { code: candidate, source: "registered-candidate" };
    if (solverMode === "candidate") {
      throw new Error(`No verified candidate code registered for ${challenge.taskName} [${challenge.language}].`);
    }
  }
  return { source: "llm" };
}

async function resolveSourceSessionPath(source: string): Promise<string> {
  if (source === "latest") {
    const sessions = await findLevel3SessionPaths();
    const latest = sessions.at(-1);
    if (!latest) throw new Error(`No Level 3 session.json files found under ${OUTPUT_ROOT}.`);
    return latest;
  }

  const resolved = path.resolve(source);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) return path.join(resolved, "session.json");
  return resolved;
}

async function findLevel3SessionPaths(): Promise<string[]> {
  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  const sessions: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.includes("level3-attempt")) continue;
    const sessionPath = path.join(OUTPUT_ROOT, entry.name, "session.json");
    try {
      await fs.access(sessionPath);
      sessions.push(sessionPath);
    } catch {
      continue;
    }
  }
  return sessions.sort();
}

function compileFeedback(challenge: Level3Challenge, compileResult: LocalCompileResult): Level3ValidationResponse {
  return {
    compiled: false,
    error: compileResult.error,
    results: challenge.checks.map((check) => ({
      problemId: check.id,
      name: check.name,
      correct: false
    }))
  };
}

function summarizeChallenge(challenge: Level3Challenge): unknown {
  return {
    id: challenge.id,
    taskName: challenge.taskName,
    language: challenge.language,
    specLength: challenge.spec.length,
    starterCodeLength: challenge.starterCode.length,
    checks: challenge.checks
  };
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

function printHelp(): void {
  console.log(`Usage:
  npm run level3:offline                 Generate/compile against latest saved Level 3 session
  npm run level3:offline -- <run-dir>     Use a specific recon-output/*-level3-attempt dir
  npm run level3:offline -- <session.json>

Environment:
  LEVEL3_OFFLINE_MAX_ATTEMPTS   Default: LEVEL3_MAX_ATTEMPTS or 6
  LEVEL3_LLM_MODEL              Per-level primary model
  LEVEL3_LLM_FALLBACK_MODELS    Comma-separated fallback model list
  SMART_LLM_MODEL               Default strong model for Level 2/3
  LEVEL3_FUNCTION_DECOMPOSITION=1
                                  Use locked data-model + per-function workers for fresh solves
  LEVEL3_SKELETON_HOLES=1         Use locked skeleton + per-hole workers for supported fresh families
  LEVEL3_DECOMP_WORKER_LLM_MODEL Default worker model is gpt-oss-120b
  LEVEL3_OFFLINE_USE_REGISTERED=1 Use verified registered candidate before LLM, even if solver mode is dynamic
`);
}

async function writeLevel3OfflineLlmTrace(
  runDir: string,
  label: string,
  result: Level3LlmSolveResult
): Promise<void> {
  await writeJson(path.join(runDir, `llm-trace-${label}.json`), {
    contract: result.contract,
    contractLength: result.contract?.length ?? 0,
    codeLength: result.code?.length ?? 0,
    calls: result.calls.map((call) => ({
      stage: call.stage,
      model: call.model,
      rawContent: call.rawContent,
      rawContentLength: call.rawContent?.length ?? 0,
      extractedContract: call.extractedContract,
      extractedCodeLength: call.extractedCodeLength,
      request: call.request
    }))
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

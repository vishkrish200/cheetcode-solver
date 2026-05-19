import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { createLevel2Client } from "./level2/api.js";
import { buildAnswersForLevel2Session, buildCachedAnswersForLevel2Session, loadLevel2CatalogFromChunks } from "./level2/catalog.js";
import { solveLevel2WithLlm } from "./level2/llm.js";
import type { Level2CatalogEntry, Level2Problem, Level2ValidationResponse, Level2PreviewResponse } from "./level2/types.js";
import { writeJson } from "./level1/api.js";
import { OUTPUT_ROOT, createRunDir } from "./recon/capture.js";

loadEnvFile();

const command = process.argv[2] ?? "run";

async function main(): Promise<void> {
  switch (command) {
    case "preview":
      await previewLevel2();
      return;
    case "run":
      await runLevel2();
      return;
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown level2 command: ${command}`);
  }
}

async function previewLevel2(): Promise<void> {
  const runDir = await createRunDir("level2-preview");
  const client = await createLevel2Client();
  const preview = await client.preview();
  await writeJson(path.join(runDir, "preview.json"), preview);

  console.log(`Level 2 preview artifacts: ${runDir}`);
  for (const project of preview.projects) {
    console.log(`- ${project.label ?? project.name ?? project.project ?? "unknown"} @ ${project.ref ?? project.commit ?? "unknown-ref"}`);
  }
  console.log(`previewToken: ${preview.previewToken}`);
}

async function runLevel2(): Promise<void> {
  const github = process.env.CHEETCODE_GITHUB ?? "trimax-eng";
  const runDir = await createRunDir("level2-attempt");
  const startedAt = Date.now();
  const solverMode = parseSolverMode(process.env.LEVEL2_SOLVER_MODE ?? "dynamic");

  const catalog = solverMode === "dynamic" ? undefined : await loadCatalog();
  if (catalog) await writeJson(path.join(runDir, "catalog-summary.json"), summarizeCatalog(catalog));

  const client = await createLevel2Client();
  const preview = await client.preview();
  await writeJson(path.join(runDir, "preview.json"), preview);

  const session = await client.startSession(preview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  let answers = await buildInitialAnswers({
    mode: solverMode,
    catalog,
    problems: session.problems,
    preview
  });
  await writeJson(path.join(runDir, "answers-00.json"), answers);

  let validation: Level2ValidationResponse | null = null;
  let solved = false;
  const maxAttempts = Number(process.env.LEVEL2_MAX_ATTEMPTS ?? 3);
  if (process.env.LEVEL2_SKIP_VALIDATE === "1") {
    await writeJson(path.join(runDir, "answers.json"), answers);
  } else {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      answers = fillMissingAnswers(answers, session.problems);
      await writeJson(path.join(runDir, `answers-${String(attempt).padStart(2, "0")}.json`), answers);

      validation = await client.validateAnswers(session.sessionId, answers);
      await writeJson(path.join(runDir, `validation-${String(attempt).padStart(2, "0")}.json`), validation);

      const wrong = validation.results.filter((result) => !result.correct);
      solved = wrong.length === 0 && validation.results.length === session.problems.length;
      console.log(`Level 2 validation ${attempt}: ${validation.results.length - wrong.length}/${session.problems.length} correct`);
      if (solved || attempt === maxAttempts) break;

      const wrongProblems = selectWrongOrMissingProblems(session.problems, answers, validation);
      const repaired = await solveLevel2WithLlm(wrongProblems, preview, { previousAnswers: answers, validation });
      if (!repaired || Object.keys(repaired).length === 0) {
        throw new Error("LLM did not return Level 2 repair answers.");
      }
      answers = { ...answers, ...repaired };
    }
    await writeJson(path.join(runDir, "answers.json"), answers);
  }

  if (!solved && process.env.LEVEL2_SKIP_VALIDATE !== "1" && process.env.LEVEL2_FINISH_UNSOLVED !== "1") {
    throw new Error(`Level 2 did not validate after ${maxAttempts} attempt(s). Artifacts: ${runDir}`);
  }

  if (process.env.LEVEL2_SKIP_VALIDATE !== "1" && validation) {
    await writeJson(path.join(runDir, "validation.json"), validation);

    const wrong = validation.results.filter((result) => !result.correct);
    if (wrong.length > 0) {
      console.warn(`Level 2 validation reported ${wrong.length} wrong answer(s): ${wrong.map((r) => r.problemId).join(", ")}`);
    }
  }

  const timeElapsed = Math.max(0, Date.now() - (session.startedAt ?? startedAt));
  const result = await client.finishSession(session, answers, github, timeElapsed);
  const finishedAt = Date.now();

  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level2",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    solverMode,
    catalogRecords: catalog?.length ?? 0,
    answered: Object.keys(answers).length,
    validation,
    solvedBeforeFinish: solved
  });

  console.log(`Level 2 attempt artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, unlocked=${result.progress?.unlockedLevel}`
  );
}

type Level2SolverMode = "dynamic" | "catalog" | "hybrid";

async function buildInitialAnswers(options: {
  mode: Level2SolverMode;
  catalog?: readonly Level2CatalogEntry[];
  problems: readonly Level2Problem[];
  preview: Level2PreviewResponse;
}): Promise<Record<string, string>> {
  if (options.mode === "catalog") {
    if (!options.catalog) throw new Error("Level 2 catalog mode requires a catalog.");
    return buildAnswersForLevel2Session(options.catalog, options.problems);
  }

  if (options.mode === "hybrid" && options.catalog) {
    const cached = buildCachedAnswersForLevel2Session(options.catalog, options.problems);
    const missing = options.problems.filter((problem) => !cached.answers[problem.id]);
    if (missing.length === 0) return cached.answers;

    const dynamicAnswers = await solveLevel2WithLlm(missing, options.preview, { previousAnswers: cached.answers });
    return { ...cached.answers, ...(dynamicAnswers ?? {}) };
  }

  const dynamicAnswers = await solveLevel2WithLlm(options.problems, options.preview);
  if (!dynamicAnswers) {
    throw new Error("Level 2 dynamic solver did not return answers.");
  }
  return dynamicAnswers;
}

function fillMissingAnswers(answers: Record<string, string>, problems: readonly Level2Problem[]): Record<string, string> {
  const filled = { ...answers };
  for (const problem of problems) {
    filled[problem.id] ??= "";
  }
  return filled;
}

function selectWrongOrMissingProblems(
  problems: readonly Level2Problem[],
  answers: Record<string, string>,
  validation: Level2ValidationResponse
): Level2Problem[] {
  const wrongIds = new Set(validation.results.filter((result) => !result.correct).map((result) => result.problemId));
  const validatedIds = new Set(validation.results.map((result) => result.problemId));
  return problems.filter((problem) => wrongIds.has(problem.id) || !validatedIds.has(problem.id) || !answers[problem.id]);
}

function parseSolverMode(value: string): Level2SolverMode {
  if (value === "dynamic" || value === "catalog" || value === "hybrid") return value;
  throw new Error(`Invalid LEVEL2_SOLVER_MODE '${value}'. Expected dynamic, catalog, or hybrid.`);
}

async function loadCatalog(): Promise<Level2CatalogEntry[]> {
  const explicit = process.env.LEVEL2_CATALOG_CHUNKS_DIR;
  if (explicit) return loadLevel2CatalogFromChunks(path.resolve(explicit));

  const latest = await findLatestChunksDirWithCatalog();
  if (!latest) {
    throw new Error(
      `Could not find a Level 2 catalog in ${OUTPUT_ROOT}. Run npm run recon -- cold, then npm run level2:preview or set LEVEL2_CATALOG_CHUNKS_DIR.`
    );
  }
  return loadLevel2CatalogFromChunks(latest);
}

async function findLatestChunksDirWithCatalog(): Promise<string | undefined> {
  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  const chunksDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(OUTPUT_ROOT, entry.name, "chunks"))
    .sort()
    .reverse();

  for (const chunksDir of chunksDirs) {
    try {
      await loadLevel2CatalogFromChunks(chunksDir);
      return chunksDir;
    } catch {
      continue;
    }
  }

  return undefined;
}

function summarizeCatalog(catalog: readonly Level2CatalogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of catalog) counts[entry.project] = (counts[entry.project] ?? 0) + 1;
  return counts;
}

function printHelp(): void {
  console.log(`Usage:
  npm run level2:preview     Safely fetch current Level 2 prereq preview. Does not start timer.
  npm run level2             Start Level 2, answer from catalog, validate, finish.

Environment:
	  CHEETCODE_GITHUB             Default: trimax-eng
	  LEVEL2_CATALOG_CHUNKS_DIR    Defaults to latest recon-output/*/chunks containing catalog
	  LEVEL2_SOLVER_MODE           dynamic, catalog, or hybrid. Default: dynamic
	  LEVEL2_LLM_MODEL             Per-level model override
	  SMART_LLM_MODEL              Default strong model for Level 2/3
	  LEVEL2_MAX_ATTEMPTS          Default: 3
	  LEVEL2_SKIP_VALIDATE=1       Submit directly without the validation endpoint
	  LEVEL2_FINISH_UNSOLVED=1     Finish even when validation did not pass
	`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { createLevel2Client } from "./level2/api.js";
import { buildAnswersForLevel2Session, loadLevel2CatalogFromChunks } from "./level2/catalog.js";
import { solveLevel2WithLlm } from "./level2/llm.js";
import { solveLevel2WithTools, type Level2ToolSolveDiagnostics } from "./level2/tools.js";
import type { Level2CatalogEntry, Level2Problem, Level2ValidationResponse, Level2PreviewResponse } from "./level2/types.js";
import { writeJson } from "./level1/api.js";
import { resolveGithubIdentity } from "./identity.js";
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
  const github = resolveGithubIdentity();
  const runDir = await createRunDir("level2-attempt");
  const startedAt = Date.now();

  if (process.env.LEVEL2_SPEED_DEMON === "1") {
    await runLevel2SpeedDemon(runDir, github, startedAt);
    return;
  }

  const solverMode = parseSolverMode(process.env.LEVEL2_SOLVER_MODE ?? "hybrid");

  const client = await createLevel2Client();
  const catalogPromise = solverMode === "dynamic" ? Promise.resolve(undefined) : loadCatalog();
  const previewPromise = client.preview();
  const [catalog, preview] = await Promise.all([catalogPromise, previewPromise]);
  if (catalog) await writeJson(path.join(runDir, "catalog-summary.json"), summarizeCatalog(catalog));
  await writeJson(path.join(runDir, "preview.json"), preview);

  const session = await client.startSession(preview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  const toolDiagnostics: Level2ToolSolveDiagnostics[] = [];
  let answers = await buildInitialAnswers({
    mode: solverMode,
    catalog,
    problems: session.problems,
    preview,
    toolDiagnostics
  });
  await writeJson(path.join(runDir, "answers-00.json"), answers);
  await writeJson(path.join(runDir, "tool-diagnostics-00.json"), toolDiagnostics);

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
      const toolRepair =
        solverMode === "dynamic"
          ? undefined
          : await solveLevel2WithTools(wrongProblems, preview, {
              catalog,
              sourceSearch: process.env.LEVEL2_SOURCE_SEARCH_REPAIR !== "0"
            });
      if (toolRepair) {
        toolDiagnostics.push(toolRepair.diagnostics);
        await writeJson(path.join(runDir, `tool-diagnostics-${String(attempt).padStart(2, "0")}.json`), toolDiagnostics);
      }

      const remainingProblems = wrongProblems.filter((problem) => !toolRepair?.answers[problem.id]);
      const repaired =
        remainingProblems.length > 0
          ? await solveLevel2WithLlm(remainingProblems, preview, { previousAnswers: { ...answers, ...toolRepair?.answers }, validation })
          : {};
      const mergedRepair = { ...(toolRepair?.answers ?? {}), ...(repaired ?? {}) };
      if (Object.keys(mergedRepair).length === 0) {
        throw new Error("LLM did not return Level 2 repair answers.");
      }
      answers = { ...answers, ...mergedRepair };
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
    toolDiagnostics,
    answered: Object.keys(answers).length,
    validation,
    solvedBeforeFinish: solved
  });

  console.log(`Level 2 attempt artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, unlocked=${result.progress?.unlockedLevel}`
  );
}

async function runLevel2SpeedDemon(runDir: string, github: string, startedAt: number): Promise<void> {
  const client = await createLevel2Client();
  const [catalog, preview] = await Promise.all([loadCatalog(), client.preview()]);

  const session = await client.startSession(preview.previewToken);
  const submitStart = Date.now();
  const answers = buildAnswersForLevel2Session(catalog, session.problems);
  const timeElapsed = Math.max(0, submitStart - (session.startedAt ?? submitStart));
  const result = await client.finishSession(session, answers, github, timeElapsed);
  const finishedAt = Date.now();

  await writeJson(path.join(runDir, "preview.json"), preview);
  await writeJson(path.join(runDir, "catalog-summary.json"), summarizeCatalog(catalog));
  await writeJson(path.join(runDir, "session.json"), session);
  await writeJson(path.join(runDir, "answers.json"), answers);
  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level2",
    mode: "speed-demon",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    submitToFinishMs: finishedAt - submitStart,
    serverTimeElapsedMs: timeElapsed,
    catalogRecords: catalog.length,
    answered: Object.keys(answers).length
  });

  console.log(`Level 2 (speed-demon) artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, serverElapsedMs=${timeElapsed}`
  );
}

type Level2SolverMode = "dynamic" | "catalog" | "hybrid" | "tools";

async function buildInitialAnswers(options: {
  mode: Level2SolverMode;
  catalog?: readonly Level2CatalogEntry[];
  problems: readonly Level2Problem[];
  preview: Level2PreviewResponse;
  toolDiagnostics?: Level2ToolSolveDiagnostics[];
}): Promise<Record<string, string>> {
  if (options.mode === "catalog") {
    if (!options.catalog) throw new Error("Level 2 catalog mode requires a catalog.");
    return buildAnswersForLevel2Session(options.catalog, options.problems);
  }

  if (options.mode === "hybrid" || options.mode === "tools") {
    const toolResult = await solveLevel2WithTools(options.problems, options.preview, {
      catalog: options.catalog,
      sourceSearch: process.env.LEVEL2_SOURCE_SEARCH !== "0"
    });
    options.toolDiagnostics?.push(toolResult.diagnostics);
    const missing = options.problems.filter((problem) => !toolResult.answers[problem.id]);
    if (missing.length === 0 || options.mode === "tools") return toolResult.answers;

    const dynamicAnswers = await solveLevel2WithLlm(missing, options.preview, { previousAnswers: toolResult.answers });
    return { ...toolResult.answers, ...(dynamicAnswers ?? {}) };
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
  if (value === "dynamic" || value === "catalog" || value === "hybrid" || value === "tools") return value;
  throw new Error(`Invalid LEVEL2_SOLVER_MODE '${value}'. Expected dynamic, catalog, hybrid, or tools.`);
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
	  CHEETCODE_GITHUB             Default: trimaxeng2
	  LEVEL2_CATALOG_CHUNKS_DIR    Defaults to latest recon-output/*/chunks containing catalog
	  LEVEL2_SOLVER_MODE           dynamic, catalog, hybrid, or tools. Default: hybrid
	  LEVEL2_SOURCE_SEARCH=0       Disable GitHub source fallback for catalog misses
	  LEVEL2_SOURCE_SEARCH_REPAIR=0 Disable GitHub source fallback when repairing wrong answers
	  LEVEL2_LLM_MODEL             Per-level model override
	  SMART_LLM_MODEL              Default strong model for Level 2/3
	  LEVEL2_MAX_ATTEMPTS          Default: 3
	  LEVEL2_SKIP_VALIDATE=1       Submit directly without the validation endpoint
	  LEVEL2_FINISH_UNSOLVED=1     Finish even when validation did not pass
	  LEVEL2_SPEED_DEMON=1         Catalog-only sub-1s submit. No validate, no tools, no LLM. Throws if catalog misses any drawn problem.
	`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

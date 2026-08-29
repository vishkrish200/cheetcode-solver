import crypto from "node:crypto";
import vm from "node:vm";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { BrowserContext, Page, Response } from "playwright";

import { loadEnvFile } from "./env.js";
import { resolveGithubIdentity } from "./identity.js";
import { buildFingerprintHints, writeJson } from "./level1/api.js";
import { hasLlmConfig as hasLevel1LlmConfig, solveWithLlm as solveLevel1WithLlm } from "./level1/llm.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { CheetProblem, FinishResponse, LevelSession, SolvedProblem } from "./level1/types.js";
import { loadLevel2CatalogFromChunks } from "./level2/catalog.js";
import { solveLevel2WithLlm } from "./level2/llm.js";
import { solveLevel2WithTools, type Level2ToolSolveDiagnostics } from "./level2/tools.js";
import type { Level2CatalogEntry, Level2PreviewResponse, Level2Problem, Level2Session, Level2ValidationResponse } from "./level2/types.js";
import { allLevel3ChecksPassed } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import type { Level3Challenge, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import {
  describeLevel3TargetMismatch,
  extractLevel3PrestartAssignment,
  extractLevel3UiFeedbackFromText
} from "./level3/ui-feedback.js";
import { extractLevel3UiSessionFromNetworkRecords } from "./level3/ui-session.js";
import {
  OUTPUT_ROOT,
  TARGET_URL,
  capturePageState,
  createAuthedContext,
  createRunDir,
  launchBrowser,
  startNetworkRecorder
} from "./recon/capture.js";
import { redactText } from "./recon/redact.js";

loadEnvFile();

interface BrowserJsonError {
  status: number;
  text: string;
}

interface PageEventRecord {
  type: "console" | "pageerror" | "dialog";
  at: string;
  message: string;
  consoleType?: string;
  location?: unknown;
}

function resolveSubmittedTimeElapsedMs(level: 1 | 2 | 3, fallbackMs: number): number {
  const raw = process.env[`LEVEL${level}_TIME_ELAPSED_MS`] ?? process.env.CHEETCODE_TIME_ELAPSED_MS;
  if (!raw?.trim()) return fallbackMs;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid submitted elapsed override for Level ${level}: ${raw}`);
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  process.env.HEADED ??= "1";

  const github = resolveGithubIdentity();
  const runDir = await createRunDir("full-headful-attempt");
  const browser = await launchBrowser();
  const startedAt = Date.now();
  const results: Record<string, unknown> = {};
  let context: BrowserContext | undefined;
  let recorder: ReturnType<typeof startNetworkRecorder> | undefined;
  let traceStarted = false;
  const pageEvents: PageEventRecord[] = [];

  try {
    context = await createAuthedContext(browser);
    if (process.env.FULL_CAPTURE_TRACE !== "0") {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      traceStarted = true;
    }
    recorder = startNetworkRecorder(context);
    const page = await context.newPage();
    attachPageEventRecorder(page, pageEvents);

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await waitForDashboard(page);
    await capturePageState(page, runDir, "00-dashboard");

    results.level1 = await runLevel1(page, runDir, github);
    await returnToDashboard(page);
    await capturePageState(page, runDir, "02-after-level1-finish");

    results.level2 = await runLevel2(page, runDir, github);
    await returnToDashboard(page);
    await capturePageState(page, runDir, "04-after-level2-finish");

    results.level3 = await runLevel3Ui(page, runDir, github, recorder.records);
    await returnToDashboard(page).catch(() => undefined);
    await capturePageState(page, runDir, "09-final-dashboard").catch(() => undefined);
  } finally {
    await writeJson(path.join(runDir, "page-events.json"), pageEvents).catch(() => undefined);
    await recorder?.writeTo(path.join(runDir, "network.json")).catch(() => undefined);
    if (traceStarted) {
      await context?.tracing.stop({ path: path.join(runDir, "trace.zip") }).catch(() => undefined);
    }
    await context?.close().catch(() => undefined);
    await browser.close();
  }

  await writeJson(path.join(runDir, "summary.json"), {
    command: "full-headful",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    results
  });

  console.log(`Full headful attempt artifacts: ${runDir}`);
  for (const [level, result] of Object.entries(results)) {
    const attempt = (result as { finish?: FinishResponse }).finish?.attempt;
    if (attempt) {
      console.log(
        `${level}: ${attempt.solved}/${attempt.total} solved, status=${attempt.status}, score=${attempt.score}, timeRemaining=${attempt.timeRemaining}`
      );
    }
  }
}

function attachPageEventRecorder(page: Page, events: PageEventRecord[]): void {
  page.on("console", (message) => {
    events.push({
      type: "console",
      at: new Date().toISOString(),
      consoleType: message.type(),
      message: redactText(message.text()),
      location: message.location()
    });
  });
  page.on("pageerror", (error) => {
    events.push({
      type: "pageerror",
      at: new Date().toISOString(),
      message: redactText(error.stack ?? error.message)
    });
  });
  page.on("dialog", (dialog) => {
    events.push({
      type: "dialog",
      at: new Date().toISOString(),
      message: redactText(dialog.message())
    });
  });
}

async function runLevel1(page: Page, runDir: string, github: string): Promise<{
  session: LevelSession;
  submissions: SolvedProblem[];
  finish: FinishResponse;
}> {
  console.log("Starting Level 1 from visible UI...");
  const session = await startLevelFromVisibleUi<LevelSession>(page, 1);
  await capturePageState(page, runDir, "01-level1-started");
  await writeJson(path.join(runDir, "level1-session.json"), session);

  const submissions = await Promise.all(session.problems.map((problem) => solveLevel1Problem(problem)));
  await writeJson(path.join(runDir, "level1-submissions.json"), submissions);

  const unknown = submissions.filter((problem) => !problem.known);
  if (unknown.length > 0) {
    console.warn(`Level 1 has ${unknown.length}/${submissions.length} unknown/sample-failing problem(s).`);
  }

  const finish = await browserPostJson<FinishResponse>(page, "/api/level-1/finish", {
    sessionId: session.sessionId,
    github,
    timeElapsed: resolveSubmittedTimeElapsedMs(1, Math.max(0, Date.now() - session.startedAt)),
    submissions: submissions.map((problem) => ({
      problemId: problem.problemId,
      code: problem.code
    }))
  });
  await writeJson(path.join(runDir, "level1-result.json"), finish);
  console.log(`Level 1 result: ${finish.attempt.solved}/${finish.attempt.total}`);
  return { session, submissions, finish };
}

async function runLevel2(page: Page, runDir: string, github: string): Promise<{
  preview: Level2PreviewResponse;
  session: Level2Session;
  answers: Record<string, string>;
  validation?: Level2ValidationResponse;
  finish: FinishResponse;
  toolDiagnostics: Level2ToolSolveDiagnostics[];
}> {
  console.log("Starting Level 2 from visible UI...");

  const preview = await browserGetJson<Level2PreviewResponse>(page, "/api/level-2/preview");
  await writeJson(path.join(runDir, "level2-preview.json"), preview);

  const session = await startLevelFromVisibleUi<Level2Session>(page, 2, async () => {
    return browserStartSession<Level2Session>(page, 2, preview.previewToken);
  });
  await capturePageState(page, runDir, "03-level2-started");
  await writeJson(path.join(runDir, "level2-session.json"), session);

  const solverMode = parseLevel2SolverMode(process.env.LEVEL2_SOLVER_MODE ?? "hybrid");
  const catalog = solverMode === "dynamic" ? undefined : await loadLevel2Catalog().catch(() => undefined);
  if (catalog) await writeJson(path.join(runDir, "level2-catalog-summary.json"), summarizeLevel2Catalog(catalog));

  const toolDiagnostics: Level2ToolSolveDiagnostics[] = [];
  let answers = await buildLevel2Answers({
    mode: solverMode,
    catalog,
    problems: session.problems,
    preview,
    toolDiagnostics
  });
  await writeJson(path.join(runDir, "level2-answers-00.json"), answers);
  await writeJson(path.join(runDir, "level2-tool-diagnostics-00.json"), toolDiagnostics);

  let validation: Level2ValidationResponse | undefined;
  const maxAttempts = Number(process.env.LEVEL2_MAX_ATTEMPTS ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    answers = fillMissingLevel2Answers(answers, session.problems);
    await writeJson(path.join(runDir, `level2-answers-${String(attempt).padStart(2, "0")}.json`), answers);
    validation = await browserPostJson<Level2ValidationResponse>(page, "/api/level-2/validate", {
      sessionId: session.sessionId,
      answers
    });
    await writeJson(path.join(runDir, `level2-validation-${String(attempt).padStart(2, "0")}.json`), validation);

    const wrong = validation.results.filter((result) => !result.correct);
    console.log(`Level 2 validation ${attempt}: ${session.problems.length - wrong.length}/${session.problems.length}`);
    if (wrong.length === 0 && validation.results.length === session.problems.length) break;
    if (attempt === maxAttempts) break;

    const wrongProblems = selectWrongOrMissingLevel2Problems(session.problems, answers, validation);
    const toolRepair =
      solverMode === "dynamic"
        ? undefined
        : await solveLevel2WithTools(wrongProblems, preview, {
            catalog,
            sourceSearch: process.env.LEVEL2_SOURCE_SEARCH_REPAIR !== "0"
          });
    if (toolRepair) {
      toolDiagnostics.push(toolRepair.diagnostics);
      await writeJson(path.join(runDir, `level2-tool-diagnostics-${String(attempt).padStart(2, "0")}.json`), toolDiagnostics);
    }

    const remaining = wrongProblems.filter((problem) => !toolRepair?.answers[problem.id]);
    const llmRepair =
      remaining.length > 0
        ? await solveLevel2WithLlm(remaining, preview, { previousAnswers: { ...answers, ...toolRepair?.answers }, validation })
        : {};
    answers = { ...answers, ...(toolRepair?.answers ?? {}), ...(llmRepair ?? {}) };
  }

  if (!validation) throw new Error("Level 2 validation did not run.");
  await writeJson(path.join(runDir, "level2-validation.json"), validation);
  await writeJson(path.join(runDir, "level2-answers.json"), answers);

  const finish = await browserPostJson<FinishResponse>(page, "/api/level-2/finish", {
    sessionId: session.sessionId,
    github,
    timeElapsed: resolveSubmittedTimeElapsedMs(2, Math.max(0, Date.now() - (session.startedAt ?? Date.now()))),
    answers
  });
  await writeJson(path.join(runDir, "level2-result.json"), finish);
  console.log(`Level 2 result: ${finish.attempt.solved}/${finish.attempt.total}`);
  return { preview, session, answers, validation, finish, toolDiagnostics };
}

async function runLevel3Ui(
  page: Page,
  runDir: string,
  github: string,
  networkRecords: Parameters<typeof extractLevel3UiSessionFromNetworkRecords>[0]
): Promise<{
  session: Level3Session;
  challenge: Level3Challenge;
  submittedCode: string;
  validation?: Level3ValidationResponse;
  finish: FinishResponse | { error: string };
  lead?: unknown;
}> {
  console.log("Starting Level 3 in visible UI...");
  const codeFile = process.env.LEVEL3_UI_CODE_FILE ?? process.env.LEVEL3_CODE_FILE;
  const maxPrestartAttempts = Math.max(1, Number(process.env.LEVEL3_UI_PRESTART_RETRIES ?? 1));
  let prestartAssignment: ReturnType<typeof extractLevel3PrestartAssignment> | undefined;
  let preloadedCode: string | undefined;

  for (let attempt = 1; attempt <= maxPrestartAttempts; attempt += 1) {
    if (attempt > 1) await returnToDashboard(page);
    await clickLevelButton(page, 3);
    await waitForLevel3Prestart(page);
    await capturePageState(page, runDir, attempt === 1 ? "05-level3-prestart" : `05-level3-prestart-${attempt}`);

    const prestartText = await readBodyText(page);
    await fs.writeFile(
      path.join(runDir, attempt === 1 ? "level3-prestart-visible-text.txt" : `level3-prestart-visible-text-${attempt}.txt`),
      redactText(prestartText)
    );
    prestartAssignment = extractLevel3PrestartAssignment(prestartText);
    await writeJson(
      path.join(runDir, attempt === 1 ? "level3-prestart-assignment.json" : `level3-prestart-assignment-${attempt}.json`),
      prestartAssignment ?? null
    );
    const mismatch = describeLevel3TargetMismatch(
      prestartText,
      process.env.LEVEL3_UI_TASK?.trim(),
      process.env.LEVEL3_UI_LANGUAGE?.trim(),
      prestartAssignment
    );
    if (mismatch) throw new Error(`${mismatch} Refusing to start Level 3 timer.`);

    preloadedCode = codeFile
      ? await fs.readFile(path.resolve(codeFile), "utf8")
      : prestartAssignment
        ? await loadLevel3CandidateCode(prestartAssignment.taskName, prestartAssignment.language, {
            allowUnverified: process.env.LEVEL3_UI_ALLOW_UNVERIFIED_REGISTERED === "1"
          })
        : undefined;
    if (preloadedCode?.trim()) break;

    if (attempt < maxPrestartAttempts) {
      console.log(
        `No server-verified Level 3 candidate for ${prestartAssignment?.taskName ?? "unknown task"} [${
          prestartAssignment?.language ?? "unknown language"
        }]; previewing another assignment...`
      );
    }
  }

  if (!preloadedCode?.trim()) {
    throw new Error(
      `No server-verified Level 3 code available for visible ${prestartAssignment?.taskName ?? "unknown task"} [${
        prestartAssignment?.language ?? "unknown language"
      }]. Refusing to start timer.`
    );
  }

  const sessionResponsePromise = waitForPostedSessionResponse(page, 3, 30_000);
  await clickMatchingControl(page, /Compiler Ready|Start Level 3|Start/i, "Level 3 start button");
  const sessionResponse = await sessionResponsePromise;
  const session =
    (sessionResponse ? await sessionResponse.json().catch(() => undefined) : undefined) ??
    extractLevel3UiSessionFromNetworkRecords(networkRecords);
  if (!isLevel3Session(session)) throw new Error("Could not extract Level 3 UI session.");

  const challenge = session.problems[0];
  if (!challenge) throw new Error("Level 3 session did not contain a challenge.");
  await waitForRenderedChallenge(page);
  await capturePageState(page, runDir, "06-level3-rendered");
  await writeJson(path.join(runDir, "level3-session.json"), session);
  await writeJson(path.join(runDir, "level3-challenge.json"), challenge);

  if (
    prestartAssignment &&
    (challenge.taskName !== prestartAssignment.taskName || challenge.language !== prestartAssignment.language)
  ) {
    throw new Error(
      `Level 3 rendered ${challenge.taskName} [${challenge.language}], not prestart ${prestartAssignment.taskName} [${prestartAssignment.language}].`
    );
  }

  const submittedCode = preloadedCode;
  await fs.writeFile(path.join(runDir, `level3-submitted.${sourceExtension(challenge.language)}`), submittedCode);
  const editMethod = await replaceEditorCode(page, submittedCode);
  await writeJson(path.join(runDir, "level3-editor-replace.json"), editMethod);
  await capturePageState(page, runDir, "07-level3-after-code-paste");

  const validationResponsePromise = page
    .waitForResponse((response) => response.url().includes("/api/level-3/validate"), { timeout: 90_000 })
    .catch(() => undefined);
  await clickMatchingControl(page, /^Run$/i, "Run button");
  const validationResponse = await validationResponsePromise;
  const validation = validationResponse
    ? ((await validationResponse.json().catch(() => undefined)) as Level3ValidationResponse | undefined)
    : undefined;
  await writeJson(path.join(runDir, "level3-validation-from-ui-network.json"), validation ?? null);

  await page.waitForTimeout(1200);
  await capturePageState(page, runDir, "08-level3-after-run-feedback");
  const visibleText = await readBodyText(page);
  await fs.writeFile(path.join(runDir, "level3-after-run-visible-text.txt"), redactText(visibleText));
  await writeJson(path.join(runDir, "level3-ui-feedback.json"), extractLevel3UiFeedbackFromText(visibleText));

  const finish =
    validation && allLevel3ChecksPassed(validation, challenge.checks.length)
      ? await browserPostJson<FinishResponse>(page, "/api/level-3/finish", {
          sessionId: session.sessionId,
          github,
          timeElapsed: resolveSubmittedTimeElapsedMs(3, 120_000),
          code: submittedCode
        }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
      : await browserPostJson<FinishResponse>(page, "/api/level-3/finish", {
          sessionId: session.sessionId,
          github,
          timeElapsed: resolveSubmittedTimeElapsedMs(3, 120_000),
          code: submittedCode
        }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  await writeJson(path.join(runDir, "level3-finish-result.json"), finish);
  if ("attempt" in finish) console.log(`Level 3 result: ${finish.attempt.solved}/${finish.attempt.total}`);
  const lead = await maybeSubmitLeadFromLevel3Results(page, runDir, github, session, finish);
  return { session, challenge, submittedCode, validation, finish, lead };
}

async function maybeSubmitLeadFromLevel3Results(
  page: Page,
  runDir: string,
  github: string,
  session: Level3Session,
  finish: FinishResponse | { error: string }
): Promise<unknown | undefined> {
  const submitAllowed =
    process.env.FULL_SUBMIT_DETAILS_ALLOW_SEND === "1" || process.env.SUBMIT_DETAILS_ALLOW_SEND === "1";
  if (!submitAllowed) return undefined;

  const email = process.env.SUBMIT_DETAILS_EMAIL ?? "cheetcode-test@example.com";
  const xHandle = process.env.SUBMIT_DETAILS_X ?? "@cheetcode_test";
  const flag = process.env.SUBMIT_DETAILS_FLAG ?? "flag{test}";
  const cleanXHandle = xHandle.startsWith("@") ? xHandle.slice(1) : xHandle;

  await writeJson(path.join(runDir, "lead-submit-input.json"), {
    email,
    xHandle: cleanXHandle,
    hasFlag: Boolean(flag),
    sessionId: session.sessionId
  });

  if (!("attempt" in finish)) {
    const skipped = { skipped: true, reason: "Level 3 finish did not return an attempt." };
    await writeJson(path.join(runDir, "lead-submit-result.json"), skipped);
    return skipped;
  }

  await page.evaluate(
    ({ github, sessionId, attempt }) => {
      const fingerprintId = localStorage.getItem("ctf:fp:visitor-id");
      localStorage.clear();
      sessionStorage.clear();
      if (fingerprintId) localStorage.setItem("ctf:fp:visitor-id", fingerprintId);
      localStorage.setItem(
        "cheetcode.v1.resultsScreen",
        JSON.stringify({
          version: 1,
          kind: "results-screen",
          screen: "results",
          currentLevel: 3,
          github,
          submittedLead: false,
          sessionId,
          results: attempt
        })
      );
    },
    { github, sessionId: session.sessionId, attempt: finish.attempt }
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.locator('input[placeholder="flag{...}"]').waitFor({ timeout: 20_000 });
  await capturePageState(page, runDir, "09-level3-results-before-lead-submit");

  await page.locator('input[placeholder="agent@company.com"], input[placeholder="you@company.com"]').first().fill(email);
  const xInput = page.locator('input[placeholder="@handle"]').first();
  if ((await xInput.count()) > 0) await xInput.fill(cleanXHandle);
  const flagInput = page.locator('input[placeholder="flag{...}"]').first();
  if ((await flagInput.count()) > 0) await flagInput.fill(flag);
  await capturePageState(page, runDir, "10-level3-results-lead-filled");

  const leadResponsePromise = page
    .waitForResponse((response) => response.url().includes("/api/leads"), { timeout: 20_000 })
    .catch(() => undefined);
  await clickMatchingControl(page, /submit details/i, "details submit button");
  const response = await leadResponsePromise;
  const result = response
    ? {
        url: response.url(),
        status: response.status(),
        body: await response.text().catch((error: unknown) => `could not read response body: ${String(error)}`)
      }
    : { error: "No /api/leads response observed within timeout." };

  await writeJson(path.join(runDir, "lead-submit-result.json"), result);
  await page.waitForTimeout(1200);
  await capturePageState(page, runDir, "11-level3-results-after-lead-submit");
  return result;
}

async function solveLevel1Problem(problem: CheetProblem): Promise<SolvedProblem> {
  const solved = solveKnownProblem(problem);
  if (!solved.known && hasLevel1LlmConfig()) {
    try {
      const llmCode = await solveLevel1WithLlm(problem);
      if (llmCode) {
        const llmSolved: SolvedProblem = {
          ...solved,
          known: true,
          source: "llm",
          code: llmCode
        };
        const validation = validateLevel1Examples(llmSolved.code, problem);
        if (validation.ok) return llmSolved;
        solved.validationError = validation.error;
      }
    } catch (error) {
      console.warn(`Level 1 LLM fallback failed for ${problem.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!solved.known) return solved;
  const validation = validateLevel1Examples(solved.code, problem);
  if (validation.ok) return solved;
  return {
    ...solved,
    known: false,
    source: "starter",
    validationError: validation.error,
    code: problem.starterCode
  };
}

function validateLevel1Examples(code: string, problem: CheetProblem): { ok: boolean; error?: string } {
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!functionName) return { ok: false, error: "Could not parse function name" };

  try {
    const context = vm.createContext({});
    vm.runInContext(`${code}; globalThis.__fn = ${functionName};`, context, { timeout: 1000 });
    const fn = context.__fn as (...args: unknown[]) => unknown;
    for (const testCase of problem.testCases) {
      const actual = fn(...testCase.args);
      if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
        return { ok: false, error: `Expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}` };
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type Level2SolverMode = "dynamic" | "catalog" | "hybrid" | "tools";

async function buildLevel2Answers(options: {
  mode: Level2SolverMode;
  catalog?: readonly Level2CatalogEntry[];
  problems: readonly Level2Problem[];
  preview: Level2PreviewResponse;
  toolDiagnostics: Level2ToolSolveDiagnostics[];
}): Promise<Record<string, string>> {
  if (options.mode === "catalog" && !options.catalog) throw new Error("Level 2 catalog mode requires a catalog.");

  if (options.mode === "hybrid" || options.mode === "tools" || options.mode === "catalog") {
    const toolResult = await solveLevel2WithTools(options.problems, options.preview, {
      catalog: options.catalog,
      sourceSearch: options.mode !== "catalog" && process.env.LEVEL2_SOURCE_SEARCH !== "0"
    });
    options.toolDiagnostics.push(toolResult.diagnostics);
    const missing = options.problems.filter((problem) => !toolResult.answers[problem.id]);
    if (missing.length === 0 || options.mode === "tools" || options.mode === "catalog") return toolResult.answers;
    const dynamic = await solveLevel2WithLlm(missing, options.preview, { previousAnswers: toolResult.answers });
    return { ...toolResult.answers, ...(dynamic ?? {}) };
  }

  const dynamic = await solveLevel2WithLlm(options.problems, options.preview);
  if (!dynamic) throw new Error("Level 2 dynamic solver did not return answers.");
  return dynamic;
}

async function loadLevel2Catalog(): Promise<Level2CatalogEntry[]> {
  const explicit = process.env.LEVEL2_CATALOG_CHUNKS_DIR;
  if (explicit) return loadLevel2CatalogFromChunks(path.resolve(explicit));

  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  const chunksDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(OUTPUT_ROOT, entry.name, "chunks"))
    .sort()
    .reverse();

  for (const chunksDir of chunksDirs) {
    try {
      return await loadLevel2CatalogFromChunks(chunksDir);
    } catch {
      // Keep looking for a captured bundle with the Level 2 bank.
    }
  }
  throw new Error(`Could not find a Level 2 catalog under ${OUTPUT_ROOT}.`);
}

function summarizeLevel2Catalog(catalog: readonly Level2CatalogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of catalog) counts[entry.project] = (counts[entry.project] ?? 0) + 1;
  return counts;
}

function fillMissingLevel2Answers(
  answers: Record<string, string>,
  problems: readonly Level2Problem[]
): Record<string, string> {
  const filled = { ...answers };
  for (const problem of problems) filled[problem.id] ??= "";
  return filled;
}

function selectWrongOrMissingLevel2Problems(
  problems: readonly Level2Problem[],
  answers: Record<string, string>,
  validation: Level2ValidationResponse
): Level2Problem[] {
  const wrongIds = new Set(validation.results.filter((result) => !result.correct).map((result) => result.problemId));
  const validatedIds = new Set(validation.results.map((result) => result.problemId));
  return problems.filter((problem) => wrongIds.has(problem.id) || !validatedIds.has(problem.id) || !answers[problem.id]);
}

function parseLevel2SolverMode(value: string): Level2SolverMode {
  if (value === "dynamic" || value === "catalog" || value === "hybrid" || value === "tools") return value;
  throw new Error(`Invalid LEVEL2_SOLVER_MODE '${value}'. Expected dynamic, catalog, hybrid, or tools.`);
}

async function startLevelFromVisibleUi<TSession extends { level: number }>(
  page: Page,
  level: 1 | 2,
  fallback?: () => Promise<TSession>
): Promise<TSession> {
  const responsePromise = waitForPostedSessionResponse(page, level, 18_000);
  await clickLevelButton(page, level);
  const response = await responsePromise;
  if (response) {
    const parsed = await response.json().catch(() => undefined);
    if (isLevelSession(parsed, level)) return parsed as TSession;
  }

  const stored = await readStoredSession<TSession>(page, level);
  if (stored) return stored;

  if (fallback) return fallback();
  return browserStartSession<TSession>(page, level);
}

async function browserStartSession<TSession extends { level: number }>(
  page: Page,
  level: 1 | 2 | 3,
  previewToken?: string
): Promise<TSession> {
  const fingerprintId = await getOrCreateFingerprintId(page);
  return browserPostJson<TSession>(page, "/api/session", {
    level,
    isDev: false,
    previewToken,
    fingerprintHints: buildFingerprintHints(fingerprintId, Date.now())
  });
}

async function browserGetJson<T>(page: Page, urlPath: string): Promise<T> {
  return browserRequestJson<T>(page, urlPath, { method: "GET" });
}

async function browserPostJson<T>(page: Page, urlPath: string, body: unknown): Promise<T> {
  return browserRequestJson<T>(page, urlPath, { method: "POST", body });
}

async function browserRequestJson<T>(
  page: Page,
  urlPath: string,
  init: { method: string; body?: unknown }
): Promise<T> {
  const fingerprintId = await getOrCreateFingerprintId(page);
  const result = await page.evaluate(
    async ({ urlPath, init, fingerprintId }) => {
      const response = await fetch(urlPath, {
        method: init.method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-client-fingerprint": fingerprintId
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });
      const text = await response.text();
      if (!response.ok) return { ok: false, status: response.status, text };
      return { ok: true, text };
    },
    { urlPath, init, fingerprintId }
  );

  if (!result.ok) {
    const error = result as BrowserJsonError;
    throw new Error(`${urlPath} failed with ${error.status}: ${error.text.slice(0, 1000)}`);
  }
  return JSON.parse(result.text) as T;
}

async function getOrCreateFingerprintId(page: Page): Promise<string> {
  const existing = await page.evaluate(() => localStorage.getItem("ctf:fp:visitor-id")).catch(() => undefined);
  if (existing) return existing;

  const generated = crypto.randomBytes(16).toString("hex");
  await page.evaluate((value) => localStorage.setItem("ctf:fp:visitor-id", value), generated).catch(() => undefined);
  return generated;
}

async function waitForPostedSessionResponse(
  page: Page,
  level: 1 | 2 | 3,
  timeout: number
): Promise<Response | undefined> {
  return page
    .waitForResponse((response) => {
      if (!response.url().includes("/api/session")) return false;
      if (response.request().method() !== "POST") return false;
      const postData = response.request().postData();
      if (!postData) return false;
      try {
        const parsed = JSON.parse(postData) as { level?: unknown };
        return parsed.level === level;
      } catch {
        return false;
      }
    }, { timeout })
    .catch(() => undefined);
}

async function readStoredSession<TSession extends { level: number }>(
  page: Page,
  level: 1 | 2 | 3
): Promise<TSession | undefined> {
  const snapshot = await page.evaluate(() => localStorage.getItem("cheetcode.v1.sessionSnapshot")).catch(() => undefined);
  if (!snapshot) return undefined;
  try {
    const parsed = JSON.parse(snapshot) as TSession;
    return parsed.level === level ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function returnToDashboard(page: Page): Promise<void> {
  await clearUiSessionSnapshot(page);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await waitForDashboard(page);
}

async function clearUiSessionSnapshot(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const fingerprintId = localStorage.getItem("ctf:fp:visitor-id");
      localStorage.clear();
      if (fingerprintId) localStorage.setItem("ctf:fp:visitor-id", fingerprintId);
      sessionStorage.clear();
    })
    .catch(() => undefined);
}

async function waitForDashboard(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return /Orchestrate/i.test(body) && /Explore/i.test(body) && /Build/i.test(body);
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

async function clickLevelButton(page: Page, level: 1 | 2 | 3): Promise<void> {
  const controls = page.locator("button, a, [role='button']");
  const count = await controls.count();
  const levelPattern = new RegExp(`\\bL${level}\\b`, "i");
  for (let index = 0; index < count; index += 1) {
    const candidate = controls.nth(index);
    const text = await candidate.innerText().catch(() => "");
    if (levelPattern.test(text) && (await candidate.isVisible().catch(() => false))) {
      await candidate.click({ timeout: 5_000 });
      return;
    }
  }
  throw new Error(`Could not find visible L${level} button.`);
}

async function replaceEditorCode(page: Page, code: string): Promise<{ method: string; firstLineVisible: boolean }> {
  const editor = page.locator(".cm-content[contenteditable='true'], [contenteditable='true'], textarea").first();
  await editor.click({ timeout: 10_000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
  await page.waitForTimeout(300);

  const firstLine = code.split(/\r?\n/, 1)[0]?.trim();
  const firstLineVisible = firstLine
    ? await page
        .locator(".cm-content, textarea, [contenteditable='true']")
        .filter({ hasText: firstLine })
        .first()
        .isVisible()
        .catch(() => false)
    : true;

  return { method: "keyboard-select-all-insert", firstLineVisible };
}

async function clickMatchingControl(page: Page, pattern: RegExp, description: string): Promise<void> {
  const locator = page.locator("button, a, [role='button']").filter({ hasText: pattern });
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ timeout: 5_000 });
      return;
    }
  }
  throw new Error(`Could not find visible ${description}.`);
}

async function readBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function waitForLevel3Prestart(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      if (/Loading your next Level 3 challenge details/i.test(body)) return false;
      var button = Array.from(document.querySelectorAll("button")).find(function(element) {
        return /Compiler Ready|Start Level 3|Start/i.test(element.innerText || element.textContent || "");
      });
      return body.length > 200 && /Compiler Ready|Start Level 3|Recommended Diagnostic|Your next Level 3 challenge|Assigned/i.test(body) && Boolean(button) && !button.disabled;
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

async function waitForRenderedChallenge(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return /Paste code|Behavior Bucket|main\\.(c|cpp|rs)|Submit/i.test(body);
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

function isLevelSession(value: unknown, level: 1 | 2 | 3): value is { level: number } {
  return !!value && typeof value === "object" && (value as { level?: unknown }).level === level;
}

function isLevel3Session(value: unknown): value is Level3Session {
  return isLevelSession(value, 3) && !!(value as Level3Session).problems?.[0];
}

function sourceExtension(language: string): string {
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  if (language === "Rust") return "rs";
  return "txt";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

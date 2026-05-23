import crypto from "node:crypto";
import vm from "node:vm";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints, writeJson } from "./level1/api.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { CheetProblem, FinishResponse, LevelSession, SolvedProblem } from "./level1/types.js";
import { buildAnswersForLevel2Session, loadLevel2CatalogFromChunks } from "./level2/catalog.js";
import type { Level2CatalogEntry, Level2PreviewResponse, Level2Session, Level2ValidationResponse } from "./level2/types.js";
import { allLevel3ChecksPassed } from "./level3/api.js";
import { findVerifiedLevel3Candidate, loadLevel3CandidateCode } from "./level3/candidates.js";
import type { Level3PreviewResponse, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import { OUTPUT_ROOT, STORAGE_STATE_PATH, TARGET_URL, createRunDir } from "./recon/capture.js";

loadEnvFile();

const FIRE_FLAG = "\u{1F525}{you_found_the_fire}";

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface StorageState {
  cookies: StorageCookie[];
  origins: unknown[];
}

interface ScoreSnapshot {
  elo: number;
  rank: number;
  score: number;
  solved: number;
}

interface SessionWithScore extends LevelSession {
  scoreSnapshot?: ScoreSnapshot | null;
}

interface LeadResponse {
  ok?: boolean;
  upserted?: string;
  error?: string;
}

interface Level1ValidationResponse {
  sessionId: string;
  problemId: string;
  expiresAt?: number;
  status?: string;
  passCount?: number;
  failCount?: number;
  totalCount?: number;
  passed?: boolean;
  error?: string;
}

interface RequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}

class ZeroRetryClient {
  private constructor(
    private readonly cookie: string,
    private readonly fingerprintId: string
  ) {}

  static async create(): Promise<ZeroRetryClient> {
    const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
    const hostname = new URL(TARGET_URL).hostname;
    const cookie = buildCookieHeader(storage.cookies, hostname);
    if (!cookie) {
      throw new Error(`No cookies for ${hostname} in ${STORAGE_STATE_PATH}. Run npm run recon -- auth:comet first.`);
    }
    return new ZeroRetryClient(cookie, crypto.randomBytes(16).toString("hex"));
  }

  getJson<T>(urlPath: string): Promise<T> {
    return this.requestJson<T>(urlPath, { method: "GET" });
  }

  postJson<T>(urlPath: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return this.requestJson<T>(urlPath, { method: "POST", body, headers });
  }

  startSession<TSession>(level: 1 | 2 | 3, previewToken?: string): Promise<TSession> {
    return this.postJson<TSession>("/api/session", {
      level,
      isDev: false,
      previewToken,
      fingerprintHints: buildFingerprintHints(this.fingerprintId, Date.now())
    });
  }

  private async requestJson<T>(urlPath: string, options: RequestOptions): Promise<T> {
    const response = await fetch(new URL(urlPath, TARGET_URL), {
      method: options.method,
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Chromium";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        referer: TARGET_URL,
        cookie: this.cookie,
        "x-client-fingerprint": this.fingerprintId,
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${urlPath} failed with ${response.status}: ${text.slice(0, 1000)}`);
    }
    return JSON.parse(text) as T;
  }
}

async function main(): Promise<void> {
  const github = readRequiredEnv("CHEETCODE_GITHUB");
  const runDir = await createRunDir("zero-retry");
  const startedAt = Date.now();
  const client = await ZeroRetryClient.create();
  const results: Record<string, unknown> = {};

  await writeJson(path.join(runDir, "input.json"), {
    targetUrl: TARGET_URL,
    github,
    outputRoot: OUTPUT_ROOT,
    storageStatePath: STORAGE_STATE_PATH,
    submitDetailsAllowed: process.env.SUBMIT_DETAILS_ALLOW_SEND === "1",
    submitEmail: process.env.SUBMIT_DETAILS_EMAIL ? "set" : "unset",
    submitX: process.env.SUBMIT_DETAILS_X ? normalizeXHandle(process.env.SUBMIT_DETAILS_X) : ""
  });

  console.log(`Zero-retry artifacts: ${runDir}`);

  const before = await readScoreSnapshot(client);
  results.before = before;
  await writeJson(path.join(runDir, "score-before.json"), before);
  if (before.scoreSnapshot) {
    console.log(`Starting score: ELO=${before.scoreSnapshot.elo}, rank=${before.scoreSnapshot.rank}`);
  } else {
    console.log("Starting score: no prior score snapshot");
  }

  results.level1 = await runLevel1(client, runDir, github);
  results.level2 = await runLevel2(client, runDir, github);
  results.level3 = await runLevel3(client, runDir, github);

  const finalScoreSession = await readScoreSnapshot(client);
  results.finalScore = finalScoreSession;
  await writeJson(path.join(runDir, "score-final.json"), finalScoreSession);

  const finalElo = finalScoreSession.scoreSnapshot?.elo;
  if (finalElo !== 3950) {
    await writeSummary(runDir, github, startedAt, results);
    throw new Error(`Final ELO was ${finalElo ?? "missing"}, not 3950. Refusing to submit official contact details.`);
  }

  console.log(`Final score verified: ELO=${finalElo}, rank=${finalScoreSession.scoreSnapshot?.rank}`);

  if (process.env.SUBMIT_DETAILS_ALLOW_SEND === "1") {
    results.lead = await submitLead(client, runDir, finalScoreSession.session.sessionId);
  } else {
    results.lead = { skipped: true, reason: "SUBMIT_DETAILS_ALLOW_SEND is not 1" };
    await writeJson(path.join(runDir, "lead-submit-result.json"), results.lead);
  }

  await writeSummary(runDir, github, startedAt, results);
  console.log(`Done. Summary: ${path.join(runDir, "summary.json")}`);
}

async function runLevel1(
  client: ZeroRetryClient,
  runDir: string,
  github: string
): Promise<{
  session: LevelSession;
  submissions: SolvedProblem[];
  finish: FinishResponse;
}> {
  console.log("L1: starting session...");
  const session = await client.startSession<LevelSession>(1);
  await writeJson(path.join(runDir, "level1-session.json"), session);

  const submissions = session.problems.map(solveAndValidateLevel1);
  await writeJson(path.join(runDir, "level1-submissions.json"), submissions);

  const unknown = submissions.filter((problem) => !problem.known);
  if (unknown.length > 0) {
    throw new Error(`L1 has ${unknown.length} unknown or sample-failing problem(s): ${unknown.map((p) => p.signature).join(", ")}`);
  }

  if (process.env.LEVEL1_SERVER_VALIDATE === "1") {
    const validation = await validateLevel1OnServer(client, session, submissions);
    await writeJson(path.join(runDir, "level1-validation.json"), validation);
    const failed = validation.filter((result) => result.passed !== true);
    if (failed.length > 0 || validation.length !== submissions.length) {
      const byId = new Map(submissions.map((submission) => [submission.problemId, submission]));
      const failures = failed
        .map((result) => byId.get(result.problemId)?.signature ?? result.problemId)
        .join(", ");
      throw new Error(`L1 server validation failed for ${failed.length} problem(s): ${failures}`);
    }
    if (elapsedSince(session.startedAt) >= 1000 && process.env.LEVEL1_ALLOW_SLOW_VALIDATED_FINISH !== "1") {
      throw new Error("L1 server validation consumed the speed-demon window. Start a fresh finish session instead.");
    }
  }

  const finish = await client.postJson<FinishResponse>(
    "/api/level-1/finish",
    {
      sessionId: session.sessionId,
      github,
      timeElapsed: readNonnegativeIntegerEnv("LEVEL1_TIME_ELAPSED_MS", 500),
      submissions: submissions.map((problem) => ({
        problemId: problem.problemId,
        code: problem.code
      })),
      flag: FIRE_FLAG
    },
    { "x-firecrawl-hack": "true" }
  );
  await writeJson(path.join(runDir, "level1-result.json"), finish);
  assertFinish(finish, 1, 25, 1370);
  assertExploitIds(finish, ["speed_demon", "flag_finder", "header_hack"]);
  console.log(`L1: ${finish.attempt.solved}/${finish.attempt.total}, score=${finish.attempt.score}`);
  return { session, submissions, finish };
}

async function validateLevel1OnServer(
  client: ZeroRetryClient,
  session: LevelSession,
  submissions: readonly SolvedProblem[]
): Promise<Level1ValidationResponse[]> {
  const results: Level1ValidationResponse[] = [];
  for (const submission of submissions) {
    const result = await client.postJson<Level1ValidationResponse>("/api/level-1/validate", {
      sessionId: session.sessionId,
      problemId: submission.problemId,
      code: submission.code
    });
    results.push(result);
  }
  return results;
}

async function runLevel2(
  client: ZeroRetryClient,
  runDir: string,
  github: string
): Promise<{
  preview: Level2PreviewResponse;
  session: Level2Session;
  answers: Record<string, string>;
  validation: Level2ValidationResponse;
  finish: FinishResponse;
}> {
  console.log("L2: previewing and loading catalog...");
  const [preview, catalog] = await Promise.all([
    client.getJson<Level2PreviewResponse>("/api/level-2/preview"),
    loadLevel2Catalog()
  ]);
  await writeJson(path.join(runDir, "level2-preview.json"), preview);
  await writeJson(path.join(runDir, "level2-catalog-summary.json"), summarizeLevel2Catalog(catalog));

  const session = await client.startSession<Level2Session>(2, preview.previewToken);
  await writeJson(path.join(runDir, "level2-session.json"), session);

  const answers = buildAnswersForLevel2Session(catalog, session.problems);
  await writeJson(path.join(runDir, "level2-answers.json"), answers);

  let validation: Level2ValidationResponse = { results: [] };
  if (process.env.LEVEL2_SERVER_VALIDATE === "1") {
    validation = await client.postJson<Level2ValidationResponse>("/api/level-2/validate", {
      sessionId: session.sessionId,
      answers
    });
    await writeJson(path.join(runDir, "level2-validation.json"), validation);

    const wrong = validation.results.filter((result) => !result.correct);
    if (wrong.length > 0 || validation.results.length !== session.problems.length) {
      throw new Error(`L2 validation failed: ${session.problems.length - wrong.length}/${session.problems.length} correct.`);
    }
  }

  const finish = await client.postJson<FinishResponse>("/api/level-2/finish", {
    sessionId: session.sessionId,
    github,
    timeElapsed: elapsedSince(session.startedAt),
    answers
  });
  await writeJson(path.join(runDir, "level2-result.json"), finish);
  assertFinish(finish, 2, 10, 1050);
  console.log(`L2: ${finish.attempt.solved}/${finish.attempt.total}, score=${finish.attempt.score}`);
  return { preview, session, answers, validation, finish };
}

async function runLevel3(
  client: ZeroRetryClient,
  runDir: string,
  github: string
): Promise<{
  previews: Level3PreviewResponse[];
  session: Level3Session;
  selectedPreview: Level3PreviewResponse;
  validation: Level3ValidationResponse;
  finish: FinishResponse;
}> {
  console.log("L3: previewing until a server-verified candidate is available...");
  const previews: Level3PreviewResponse[] = [];
  const maxPreviewAttempts = readNonnegativeIntegerEnv("LEVEL3_PREVIEW_ATTEMPTS", 50);
  let selectedPreview: Level3PreviewResponse | undefined;
  let code: string | undefined;

  for (let attempt = 1; attempt <= maxPreviewAttempts; attempt += 1) {
    const preview = await client.getJson<Level3PreviewResponse>("/api/level-3/preview");
    previews.push(preview);
    const verified = findVerifiedLevel3Candidate(preview.taskName, preview.language);
    code = verified ? await loadLevel3CandidateCode(preview.taskName, preview.language) : undefined;
    console.log(`L3 preview ${attempt}: ${preview.taskName} [${preview.language}] ${code ? "verified" : "unverified"}`);
    if (code?.trim()) {
      selectedPreview = preview;
      break;
    }
  }

  await writeJson(path.join(runDir, "level3-previews.json"), previews);
  if (!selectedPreview || !code?.trim()) {
    throw new Error(`No server-verified L3 candidate found after ${maxPreviewAttempts} preview(s). Refusing to start L3 timer.`);
  }

  const session = await client.startSession<Level3Session>(3, selectedPreview.previewToken);
  await writeJson(path.join(runDir, "level3-session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) throw new Error("L3 session did not include a challenge.");
  if (challenge.taskName !== selectedPreview.taskName || challenge.language !== selectedPreview.language) {
    throw new Error(
      `L3 session mismatch: preview was ${selectedPreview.taskName} [${selectedPreview.language}], session was ${challenge.taskName} [${challenge.language}].`
    );
  }

  await fs.writeFile(path.join(runDir, `level3-submission.${sourceExtension(challenge.language)}`), code);
  const validation = await client.postJson<Level3ValidationResponse>("/api/level-3/validate", {
    sessionId: session.sessionId,
    challengeId: challenge.id,
    code
  });
  await writeJson(path.join(runDir, "level3-validation.json"), validation);
  if (!allLevel3ChecksPassed(validation, challenge.checks.length)) {
    throw new Error(`L3 validation did not pass all checks. Refusing to finish. Artifacts: ${runDir}`);
  }

  const finish = await client.postJson<FinishResponse>("/api/level-3/finish", {
    sessionId: session.sessionId,
    github,
    timeElapsed: elapsedSince(session.startedAt),
    code
  });
  await writeJson(path.join(runDir, "level3-result.json"), finish);
  assertFinish(finish, 3, 25, 1530);
  console.log(`L3: ${finish.attempt.solved}/${finish.attempt.total}, score=${finish.attempt.score}`);
  return { previews, session, selectedPreview, validation, finish };
}

async function readScoreSnapshot(
  client: ZeroRetryClient
): Promise<{
  session: SessionWithScore;
  scoreSnapshot?: ScoreSnapshot | null;
}> {
  const session = await client.startSession<SessionWithScore>(1);
  return { session, scoreSnapshot: session.scoreSnapshot };
}

async function submitLead(
  client: ZeroRetryClient,
  runDir: string,
  sessionId: string
): Promise<{
  request: { email: string; xHandle: string; flag: string; sessionId: string };
  response: LeadResponse;
}> {
  const email = readRequiredEnv("SUBMIT_DETAILS_EMAIL");
  const xHandle = normalizeXHandle(process.env.SUBMIT_DETAILS_X ?? "");
  const flag = process.env.SUBMIT_DETAILS_FLAG ?? FIRE_FLAG;
  const request = { email, xHandle, flag, sessionId };
  await writeJson(path.join(runDir, "lead-submit-input.json"), { ...request, email: "redacted" });

  const response = await client.postJson<LeadResponse>("/api/leads", request);
  await writeJson(path.join(runDir, "lead-submit-result.json"), response);
  if (response.ok !== true) throw new Error(`Official details submission failed: ${JSON.stringify(response)}`);
  console.log(`Official details submitted: ${response.upserted ?? "ok"}`);
  return { request, response };
}

function solveAndValidateLevel1(problem: CheetProblem): SolvedProblem {
  const solved = solveKnownProblem(problem);
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

async function loadLevel2Catalog(): Promise<Level2CatalogEntry[]> {
  const candidates = [
    process.env.LEVEL2_CATALOG_CHUNKS_DIR,
    path.join(OUTPUT_ROOT, "2026-05-21T18-website-clue-hunt", "all-advertised-chunks"),
    path.join(OUTPUT_ROOT, "2026-05-21T17-27-13-scoring-investigation", "chunks"),
    path.join(OUTPUT_ROOT, "2026-05-19T09-14-22-928Z-cold", "chunks")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return await loadLevel2CatalogFromChunks(path.resolve(candidate));
    } catch {
      continue;
    }
  }

  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  const chunksDirs = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join(OUTPUT_ROOT, entry.name, "all-advertised-chunks"),
      path.join(OUTPUT_ROOT, entry.name, "chunks")
    ])
    .sort()
    .reverse();

  for (const chunksDir of chunksDirs) {
    try {
      return await loadLevel2CatalogFromChunks(chunksDir);
    } catch {
      continue;
    }
  }

  throw new Error(`Could not find a Level 2 catalog under ${OUTPUT_ROOT}.`);
}

function summarizeLevel2Catalog(catalog: readonly Level2CatalogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of catalog) counts[entry.project] = (counts[entry.project] ?? 0) + 1;
  return counts;
}

function assertFinish(finish: FinishResponse, level: number, solved: number, minScore: number): void {
  if (finish.attempt.level !== level) throw new Error(`Expected L${level} result, got L${finish.attempt.level}.`);
  if (finish.attempt.solved !== solved || finish.attempt.status !== "completed") {
    throw new Error(`L${level} finish was not perfect: ${finish.attempt.solved}/${finish.attempt.total}, status=${finish.attempt.status}.`);
  }
  if (finish.attempt.score < minScore) {
    throw new Error(`L${level} score ${finish.attempt.score} was below expected minimum ${minScore}.`);
  }
}

function assertExploitIds(finish: FinishResponse, expectedIds: readonly string[]): void {
  const exploits = Array.isArray(finish.attempt.exploits) ? finish.attempt.exploits : [];
  const ids = new Set(
    exploits
      .map((exploit) => (exploit && typeof exploit === "object" ? (exploit as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string")
  );
  const missing = expectedIds.filter((id) => !ids.has(id));
  if (missing.length > 0) throw new Error(`L1 missing exploit(s): ${missing.join(", ")}`);
}

function elapsedSince(startedAt?: number): number {
  if (!startedAt) return 0;
  return Math.max(0, Date.now() - startedAt);
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  return "cpp";
}

function normalizeXHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const handle = parsed.pathname.split("/").filter(Boolean).at(0) ?? "";
    return handle.replace(/^@/, "");
  } catch {
    return trimmed.replace(/^@/, "");
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readNonnegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return Math.floor(parsed);
}

async function writeSummary(
  runDir: string,
  github: string,
  startedAt: number,
  results: Record<string, unknown>
): Promise<void> {
  await writeJson(path.join(runDir, "summary.json"), {
    command: "zero-retry",
    targetUrl: TARGET_URL,
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt: Date.now(),
    elapsedMs: Date.now() - startedAt,
    results
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

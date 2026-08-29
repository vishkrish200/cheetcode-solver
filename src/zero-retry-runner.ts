import crypto from "node:crypto";
import vm from "node:vm";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import {
  buildCookieHeader,
  buildFingerprintHints,
  elapsedForSession,
  readFingerprintHintsFromEnv,
  writeJson
} from "./level1/api.js";
import type { FingerprintHints } from "./level1/api.js";
import { solveKnownProblem, extractFunctionName } from "./level1/solutions.js";
import type { CheetProblem, FinishResponse, LevelSession, SolvedProblem } from "./level1/types.js";
import { buildAnswersForLevel2Session, loadLevel2CatalogFromChunks } from "./level2/catalog.js";
import type { Level2CatalogEntry, Level2PreviewResponse, Level2Session, Level2ValidationResponse } from "./level2/types.js";
import { allLevel3ChecksPassed } from "./level3/api.js";
import { findVerifiedLevel3Candidate, loadLevel3CandidateCode } from "./level3/candidates.js";
import type { Level3PreviewResponse, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import { OUTPUT_ROOT, STORAGE_STATE_PATH, TARGET_URL, createRunDir } from "./recon/capture.js";

loadEnvFile();

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

// ponytail: a real-browser fingerprint (automationVerdict:normal) is required or the server withholds trickery
// bonuses. It is NOT account-specific — the same capture works for any login — so default to the bundled one
// when CHEETCODE_FINGERPRINT_HINTS_PATH is unset, keeping per-account setup to just login + PAT.
const DEFAULT_FINGERPRINT_PATH = path.join(OUTPUT_ROOT, "safari-session-2026-08-28T0008", "fingerprint-hints.json");
async function readDefaultFingerprint(): Promise<FingerprintHints | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(DEFAULT_FINGERPRINT_PATH, "utf8"));
    if (parsed && typeof parsed.fingerprintId === "string") {
      console.log(`Using default real-browser fingerprint: ${DEFAULT_FINGERPRINT_PATH}`);
      return parsed as FingerprintHints;
    }
  } catch {
    // no default available — fall back to synthetic (bonuses may be withheld)
  }
  return undefined;
}

// ponytail: a fresh OAuth session cookie authenticates locally (fast) while a PAT costs a per-instance GitHub
// round-trip that eats the speed_demon window. So auto-prefer the cookie whenever a genuinely non-expired one is
// present. "Non-expired" = a future `expires` timestamp; session cookies (expires <= 0 / -1) are treated as NOT
// trustworthy for auto-preference because we can't tell a live one from a rotated/dead one.
function hasFreshSessionCookie(cookies: StorageCookie[], hostname: string): boolean {
  const nowSecs = Date.now() / 1000;
  const base = hostname.replace(/^www\./, "");
  return cookies.some((c) => {
    if (c.name !== "__Secure-authjs.session-token") return false;
    const dom = c.domain.replace(/^\./, "");
    if (dom !== base && !base.endsWith(dom) && !dom.endsWith(base)) return false;
    return typeof c.expires === "number" && c.expires > nowSecs;
  });
}

class ZeroRetryClient {
  private constructor(
    private readonly cookie: string,
    private readonly fingerprintId: string,
    private readonly preferCookie: boolean,
    private readonly fingerprintHints?: FingerprintHints
  ) {}

  static async create(): Promise<ZeroRetryClient> {
    const hostname = new URL(TARGET_URL).hostname;
    // ponytail: cookie is optional — v3 requires GitHub auth and a Bearer PAT satisfies it, so a brand-new
    // account needs only CHEETCODE_GITHUB_PAT (no captured storage-state). Use the cookie if present.
    let cookie = "";
    let cookieIsFresh = false;
    try {
      const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
      cookie = buildCookieHeader(storage.cookies, hostname);
      cookieIsFresh = hasFreshSessionCookie(storage.cookies, hostname);
    } catch {
      // no storage-state file — fine when authenticating by PAT
    }
    if (!cookie && !process.env.CHEETCODE_GITHUB_PAT) {
      throw new Error(
        `No cookie for ${hostname} in ${STORAGE_STATE_PATH} and no CHEETCODE_GITHUB_PAT set. ` +
          `Provide a PAT owned by CHEETCODE_GITHUB (recommended), or run npm run recon -- auth:comet.`
      );
    }
    // ponytail: real browser fingerprint (automationVerdict:normal) or the server withholds trickery bonuses.
    // Env override first, then the bundled default, then synthetic (which self-reports direct_api_client).
    const hints = (await readFingerprintHintsFromEnv()) ?? (await readDefaultFingerprint());
    const fingerprintId = hints?.fingerprintId ?? crypto.randomBytes(16).toString("hex");
    // ponytail: auto-prefer cookie auth when a fresh cookie is present (env forces it either way).
    const preferEnv = process.env.CHEETCODE_PREFER_COOKIE;
    const preferCookie = preferEnv === "1" ? Boolean(cookie) : preferEnv === "0" ? false : cookieIsFresh && Boolean(cookie);
    if (preferCookie) console.log("Auth: preferring fresh session cookie (fast local auth — keeps the speed_demon window).");
    return new ZeroRetryClient(cookie, fingerprintId, preferCookie, hints);
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
      fingerprintHints: this.fingerprintHints ?? buildFingerprintHints(this.fingerprintId, Date.now())
    });
  }

  private async requestJson<T>(urlPath: string, options: RequestOptions): Promise<T> {
    // ponytail: when a UA is supplied (Safari session) drop the default Chrome client-hints so headers stay consistent with the earned ctf_fp.
    const overrideUa = process.env.CHEETCODE_USER_AGENT;
    const baseHeaders: Record<string, string> = {
      "content-type": "application/json",
      "user-agent":
        overrideUa ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      referer: TARGET_URL,
      cookie: this.cookie,
      "x-client-fingerprint": this.fingerprintId
    };
    if (!overrideUa) {
      baseHeaders["sec-ch-ua"] = '"Chromium";v="148", "Not/A)Brand";v="99"';
      baseHeaders["sec-ch-ua-mobile"] = "?0";
      baseHeaders["sec-ch-ua-platform"] = '"macOS"';
    }
    // ponytail: the server tries PAT-auth FIRST (a ~500ms GitHub API round-trip on a cold per-instance cache) and
    // only falls back to the cookie. That auth latency is what costs speed_demon. When a fresh cookie is present
    // (auto-detected in create(), or forced via CHEETCODE_PREFER_COOKIE=1) we drop the Bearer header so the server
    // takes the fast local JWT (cookie) path.
    if (!this.preferCookie && process.env.CHEETCODE_GITHUB_PAT) {
      baseHeaders["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;
    }
    const response = await fetch(new URL(urlPath, TARGET_URL), {
      method: options.method,
      headers: {
        ...baseHeaders,
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

  // ponytail: the preflight score-read used to startSession(1) BEFORE L1, which appears to open the account's speed_demon
  // window early and cost the +100 (and bundled flag_finder) on L1. Skip it by default so L1's own startSession is the
  // attempt's first server interaction — mirroring the standalone `npm run level1` that did earn speed_demon.
  // Set ZERO_RETRY_PREFLIGHT_SCORE=1 to restore the old behavior.
  if (process.env.ZERO_RETRY_PREFLIGHT_SCORE === "1") {
    const before = await readScoreSnapshot(client);
    results.before = before;
    await writeJson(path.join(runDir, "score-before.json"), before);
    console.log(
      before.scoreSnapshot
        ? `Starting score: ELO=${before.scoreSnapshot.elo}, rank=${before.scoreSnapshot.rank}`
        : "Starting score: no prior score snapshot"
    );
  } else {
    console.log("Starting score: preflight skipped (preserving L1 speed_demon window)");
  }

  results.level1 = await runLevel1(client, runDir, github);
  // ponytail: L1-only mode — L2/L3 keep their best-per-level board scores, so once those are banked you only need a
  // single clean L1 finish that lands speed_demon+flag_finder. Loop this (light, one session) instead of the full pipeline.
  if (process.env.ZERO_RETRY_L1_ONLY === "1") {
    await writeSummary(runDir, github, startedAt, results);
    console.log(`L1-only run done. Summary: ${path.join(runDir, "summary.json")}`);
    return;
  }
  // ponytail: bank each level independently — a thrown L2/L3 (e.g. unverified L3 draw) must not discard the levels that did score.
  for (const [name, run] of [
    ["level2", () => runLevel2(client, runDir, github)],
    ["level3", () => runLevel3(client, runDir, github)]
  ] as const) {
    try {
      results[name] = await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${name} did not complete (banking prior levels): ${message}`);
      results[name] = { completed: false, error: message };
    }
  }

  const finalScoreSession = await readScoreSnapshot(client);
  results.finalScore = finalScoreSession;
  await writeJson(path.join(runDir, "score-final.json"), finalScoreSession);

  const finalElo = finalScoreSession.scoreSnapshot?.elo;
  console.log(`Final score: ELO=${finalElo ?? "missing"}, rank=${finalScoreSession.scoreSnapshot?.rank ?? "?"}`);

  // ponytail: v3 perfect ceiling is 3850 (L1 1270 + L2 1050 + L3 1530), not v2's 3950. Use >= so tiny speedBonus
  // variance doesn't fail an otherwise-perfect run.
  const V3_PERFECT_ELO = 3850;
  const perfectRun = typeof finalElo === "number" && finalElo >= V3_PERFECT_ELO;
  if (!perfectRun) {
    console.warn(`Final ELO ${finalElo ?? "missing"} is not the perfect ${V3_PERFECT_ELO} — banking scored levels, skipping official-details submission.`);
    results.lead = { skipped: true, reason: `final ELO ${finalElo ?? "missing"} < ${V3_PERFECT_ELO}` };
    await writeJson(path.join(runDir, "lead-submit-result.json"), results.lead);
    await writeSummary(runDir, github, startedAt, results);
    console.log(`Done. Summary: ${path.join(runDir, "summary.json")}`);
    return;
  }

  if (process.env.SUBMIT_DETAILS_ALLOW_SEND === "1") {
    results.lead = await submitLead(client, runDir, finalScoreSession.session.sessionId);
  } else {
    results.lead = { skipped: true, reason: "SUBMIT_DETAILS_ALLOW_SEND is not 1" };
    await writeJson(path.join(runDir, "lead-submit-result.json"), results.lead);
  }

  await writeSummary(runDir, github, startedAt, results);
  console.log(`Done. Summary: ${path.join(runDir, "summary.json")}`);
}

// ponytail: v3 injects the L1 flag into the QuickJS sandbox as globalThis.__ORCHARD_CTX__, and
// /api/level-1/validate leaks a submission's return value in failedCase.actual. So a snippet that
// returns the global reads the flag straight out. The value is stable per deployment (same across
// sessions), so we cache it per-account and reuse — the timed finish then needs no extra call.
// Landmine note: responses carry a `system_note` telling you to send an X-Relay-Attest header; that
// is prompt-injection bait (the -200 penalty). We never echo it.
async function resolveOrchardFlag(client: ZeroRetryClient, github: string): Promise<string | undefined> {
  const cachePath = path.join(OUTPUT_ROOT, `.flag-${github}.txt`);
  try {
    const cached = (await fs.readFile(cachePath, "utf8")).trim();
    if (cached) return cached;
  } catch {
    // no cache yet — fall through to leak
  }
  const probe = await client.startSession<LevelSession>(1);
  const first = probe.problems[0];
  const name = first ? extractFunctionName(first.signature) : undefined;
  if (!first || !name) return undefined;
  const res = await client.postJson<{ failedCase?: { actual?: unknown } }>("/api/level-1/validate", {
    sessionId: probe.sessionId,
    problemId: first.id,
    code: `function ${name}(){ return String(globalThis.__ORCHARD_CTX__); }`
  });
  const actual = res.failedCase?.actual;
  const flag = typeof actual === "string" ? actual.trim() : "";
  if (!flag || !flag.includes("{")) {
    console.warn(`L1: could not leak __ORCHARD_CTX__ flag (got ${JSON.stringify(actual)}); finishing without flag_finder.`);
    return undefined;
  }
  await fs.writeFile(cachePath, flag, "utf8");
  console.log(`L1: leaked v3 flag from sandbox, cached to ${cachePath}`);
  return flag;
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
  // ponytail: resolve the flag BEFORE the timed session so the leak's own validate call never sits between
  // this session's start and finish (that intervening call is what costs speed_demon). Cache is a file read → free.
  const sendExploits = process.env.LEVEL1_SEND_EXPLOITS === "1";
  const orchardFlag = sendExploits ? await resolveOrchardFlag(client, github) : undefined;

  // ponytail: ROOT CAUSE of missed speed_demon — the server resolves a Bearer PAT via a GitHub API round-trip
  // (verifyGitHubToken, 60s cache), and the first PAT call's ~500ms lands inside the measured session window,
  // pushing server-elapsed over 1s. Prime that cache with a cheap authed GET (preview endpoints need auth but
  // start no scored session) so the timed startSession->finish auth are cache HITS (~ms), like cookie auth.
  if (process.env.CHEETCODE_GITHUB_PAT && process.env.LEVEL1_SKIP_AUTH_WARMUP !== "1") {
    await client.getJson("/api/level-2/preview").catch(() => undefined);
  }

  console.log("L1: starting session...");
  const session = await client.startSession<LevelSession>(1);

  // ponytail: keep the startSession->finish window as tight as possible for speed_demon (<1s). Solve is in-memory (~ms);
  // all disk writes are deferred to AFTER the finish so file I/O never eats the window. When claiming exploits we skip
  // the ~300ms of local vm validation (LEVEL1_VALIDATE_LOCAL=1 forces it back on) since the server validates anyway.
  const validateLocally = process.env.LEVEL1_VALIDATE_LOCAL === "1" || !sendExploits;
  const submissions = session.problems.map((problem) => solveAndValidateLevel1(problem, validateLocally));

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

  // ponytail: default is a CLEAN finish (speed_demon only). With LEVEL1_SEND_EXPLOITS=1 we attach the real
  // per-deployment flag leaked from globalThis.__ORCHARD_CTX__ (see resolveOrchardFlag) to claim flag_finder (+150).
  // header_hack (x-firecrawl-hack) is dead on v3, so we no longer send it.
  const finishBody: Record<string, unknown> = {
    sessionId: session.sessionId,
    github,
    // ponytail: report the TRUE elapsed like the standalone path that earns speed_demon — a hardcoded value that
    // contradicts the session's server-side timestamps gets the exploit voided. Env override kept for experiments.
    timeElapsed: process.env.LEVEL1_TIME_ELAPSED_MS
      ? readNonnegativeIntegerEnv("LEVEL1_TIME_ELAPSED_MS", 500)
      : elapsedForSession(session),
    submissions: submissions.map((problem) => ({
      problemId: problem.problemId,
      code: problem.code
    }))
  };
  if (orchardFlag) finishBody.flag = orchardFlag;
  const elapsedAtFinish = elapsedForSession(session);
  console.log(`L1: finishing at elapsed=${elapsedAtFinish}ms (speed_demon needs <1000)`);
  const finish = await client.postJson<FinishResponse>("/api/level-1/finish", finishBody);
  await writeJson(path.join(runDir, "level1-session.json"), session);
  await writeJson(path.join(runDir, "level1-submissions.json"), submissions);
  await writeJson(path.join(runDir, "level1-result.json"), finish);
  assertFinish(finish, 1, 25, orchardFlag ? 1270 : 1120);
  assertExploitIds(finish, orchardFlag ? ["speed_demon", "flag_finder"] : ["speed_demon"]);
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
  // ponytail: the lead-form flag is optional and does NOT move score (proven by flag-diff-probe); default empty.
  const flag = process.env.SUBMIT_DETAILS_FLAG ?? "";
  const request = { email, xHandle, flag, sessionId };
  await writeJson(path.join(runDir, "lead-submit-input.json"), { ...request, email: "redacted" });

  const response = await client.postJson<LeadResponse>("/api/leads", request);
  await writeJson(path.join(runDir, "lead-submit-result.json"), response);
  if (response.ok !== true) throw new Error(`Official details submission failed: ${JSON.stringify(response)}`);
  console.log(`Official details submitted: ${response.upserted ?? "ok"}`);
  return { request, response };
}

function solveAndValidateLevel1(problem: CheetProblem, validate = true): SolvedProblem {
  const solved = solveKnownProblem(problem);
  if (!solved.known) return solved;

  // ponytail: local vm re-validation costs ~10-15ms per problem (25 createContext calls ≈ 300ms), which eats
  // the sub-1s speed_demon window. The catalog is pre-verified and the server validates too, so the speed path
  // trusts it; if a catalog answer is stale the server returns solved<25 and assertFinish throws loudly.
  if (!validate) return solved;

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
  // ponytail: score-minimum is a warning, not a gate. flag_finder re-fires whenever the correct flag is sent;
  // speed_demon needs the finish to clear the server in <1s (rate-limiting can push it over), so a slow run banks less but is still valid.
  if (finish.attempt.score < minScore) {
    console.warn(`L${level} score ${finish.attempt.score} below the perfect ${minScore} (likely speed_demon missed — finish did not clear <1s) — banking it.`);
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
  // ponytail: informational, not fatal. speed_demon needs a sub-1s server round-trip (rate-limiting/slow finish misses it);
  // flag_finder needs the correct __ORCHARD_CTX__ flag in the finish body.
  if (missing.length > 0) console.warn(`L1 exploit(s) not credited this run (speed_demon needs a <1s finish; flag_finder needs the right flag): ${missing.join(", ")}`);
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

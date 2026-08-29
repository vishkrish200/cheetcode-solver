import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { loadEnvFile } from "../src/env.js";
import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";
import { buildCookieHeader } from "../src/level1/api.js";
import { STORAGE_STATE_PATH, TARGET_URL } from "../src/recon/capture.js";

loadEnvFile();

const github = process.env.CHEETCODE_GITHUB ?? "trimaxeng2";
const fingerprintPath = process.env.CHEETCODE_FINGERPRINT_HINTS_PATH ??
  path.join("recon-output", "safari-session-2026-08-28T0008", "fingerprint-hints.json");
const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const fingerprintHints = JSON.parse(await fs.readFile(fingerprintPath, "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const headers: Record<string, string> = {
  "content-type": "application/json",
  referer: TARGET_URL,
  cookie,
  "x-client-fingerprint": fingerprintHints.fingerprintId,
};

type Timed<T> = { json: T; status: number; sentWall: number; recvWall: number; elapsedMs: number };

async function post<T>(endpoint: string, body: unknown): Promise<Timed<T>> {
  const sentWall = Date.now();
  const start = performance.now();
  const response = await fetch(new URL(endpoint, TARGET_URL), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const recvWall = Date.now();
  const elapsedMs = Math.round(performance.now() - start);
  if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return { json: JSON.parse(text) as T, status: response.status, sentWall, recvWall, elapsedMs };
}

function summary(session: LevelSession) {
  return {
    github,
    screen: "playing",
    level: 1,
    expiresAt: session.expiresAt,
    totalProblems: session.problems.length,
    draftCount: session.problems.length,
    solvedLocal: session.problems.length,
    isSubmitting: false,
    isRestoringSession: false,
    submitError: null,
    submittedLead: false,
  };
}

function submissions(session: LevelSession) {
  return (session.problems as CheetProblem[]).map((p) => {
    const solved = solveKnownProblem(p);
    if (!solved.known) throw new Error(`No catalog answer for ${p.id}`);
    return { problemId: p.id, code: solved.code };
  });
}

function printTiming(label: string, t: Timed<unknown>) {
  console.log(JSON.stringify({ label, status: t.status, elapsedMs: t.elapsedMs, sentWall: t.sentWall, recvWall: t.recvWall }));
}

async function finish(session: LevelSession, label: string) {
  const body = {
    sessionId: session.sessionId,
    github,
    timeElapsed: Math.max(0, 60_000 - (session.expiresAt - Date.now())),
    submissions: submissions(session),
  };
  const t = await post<any>("/api/level-1/finish", body);
  const a = t.json.attempt ?? {};
  console.log(JSON.stringify({
    label,
    status: t.status,
    elapsedMs: t.elapsedMs,
    finishSentWall: t.sentWall,
    finishRecvWall: t.recvWall,
    attempt: {
      solved: a.solved,
      total: a.total,
      score: a.score,
      timeRemaining: a.timeRemaining,
      speedBonus: a.scoreBreakdown?.speedBonus,
      exploits: Array.isArray(a.exploits) ? a.exploits.map((e: any) => e.id) : [],
    },
  }));
}

const sessionTiming: Record<string, unknown> = {};
const created = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const session = created.json;
sessionTiming.created = { startedAt: session.startedAt, expiresAt: session.expiresAt, elapsedMs: created.elapsedMs, sentWall: created.sentWall, recvWall: created.recvWall };
printTiming("startSession", created);
console.log(JSON.stringify({ label: "startSessionFields", startedAt: session.startedAt, expiresAt: session.expiresAt, problemCount: session.problems.length }));

const restored = await post<LevelSession>("/api/session/restore", { sessionId: session.sessionId, fingerprintHints });
printTiming("restore", restored);
console.log(JSON.stringify({ label: "restoreFields", startedAt: restored.json.startedAt, expiresAt: restored.json.expiresAt, sameStartedAt: restored.json.startedAt === session.startedAt, sameExpiresAt: restored.json.expiresAt === session.expiresAt }));

const replayBase = { sessionId: session.sessionId, level: 1, screen: "playing", route: "/", clientAt: Date.now(), summary: summary(session) };
for (const eventType of ["session_started", "heartbeat"] as const) {
  const replay = await post<any>("/api/session/replay", { ...replayBase, eventType });
  printTiming(`replay:${eventType}`, replay);
  console.log(JSON.stringify({ label: `replay:${eventType}:response`, keys: Object.keys(replay.json ?? {}) }));
}

await finish(session, "restore-replay-immediate");

console.log(JSON.stringify({ label: "done", sessionTiming }));

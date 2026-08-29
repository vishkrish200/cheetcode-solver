import { promises as fs } from "node:fs";
import http2 from "node:http2";
import { performance } from "node:perf_hooks";

import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";
import { buildCookieHeader } from "../src/level1/api.js";
import { STORAGE_STATE_PATH, TARGET_URL } from "../src/recon/capture.js";

const github = "trimaxeng2";
const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const hints = JSON.parse(await fs.readFile(process.env.CHEETCODE_FINGERPRINT_HINTS_PATH ?? "recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json", "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const headers = {
  cookie,
  "x-client-fingerprint": hints.fingerprintId,
  referer: TARGET_URL,
  "content-type": "application/json",
  "user-agent": "cheetcode-h2-investigation/1.0"
};

type Reply<T = unknown> = { body: T; status: number; elapsedMs: number; sentWall: number; recvWall: number };

function req<T>(client: http2.ClientHttp2Session, path: string, method: string, body?: unknown, allowError = false): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const sentWall = Date.now();
    const t0 = performance.now();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const stream = client.request({ ":method": method, ":path": path, ":authority": "ctf.firecrawl.dev", ...headers, ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) });
    const chunks: Buffer[] = [];
    let status = 0;
    stream.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => {
      const recvWall = Date.now();
      const text = Buffer.concat(chunks).toString("utf8");
      if (!allowError && (status < 200 || status >= 300)) return reject(new Error(`${path} HTTP ${status}`));
      let parsed: T;
      try { parsed = JSON.parse(text) as T; } catch { parsed = text as T; }
      resolve({ body: parsed, status, elapsedMs: Math.round(performance.now() - t0), sentWall, recvWall });
    });
    if (payload) stream.end(payload); else stream.end();
  });
}

// Allowed read-only Convex query: warms the deployment without touching a CheetCode session.
const convexWarm = await fetch("https://moonlit-gnu-522.convex.cloud/api/query", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: "leaderboard:getAll", args: { scoreVersion: 3 }, format: "json" })
});
await convexWarm.arrayBuffer();

const client = http2.connect("https://ctf.firecrawl.dev");
await new Promise<void>((resolve, reject) => { client.once("connect", () => resolve()); client.once("error", reject); });
// Route warmup is intentionally harmless; 405 is expected and ignored.
const routeWarm = await req(client, "/api/level-1/finish", "GET", undefined, true);
const start = await req<LevelSession>(client, "/api/session", "POST", { level: 1, isDev: false, fingerprintHints: hints });
const session = start.body;
const problem = (session.problems as CheetProblem[]).map((p) => ({ p, solved: solveKnownProblem(p) })).find(({ solved }) => solved.known);
if (!problem) throw new Error("No known catalog problem assigned");
const finish = await req<any>(client, "/api/level-1/finish", "POST", {
  sessionId: session.sessionId,
  github,
  timeElapsed: Math.max(0, 60_000 - (session.expiresAt - Date.now())),
  submissions: [{ problemId: problem.p.id, code: problem.solved.code }]
});
const a = finish.body?.attempt ?? {};
console.log(JSON.stringify({
  httpVersion: client.alpnProtocol,
  convexWarmStatus: convexWarm.status,
  routeWarmStatus: routeWarm.status,
  routeWarmMs: routeWarm.elapsedMs,
  startRttMs: start.elapsedMs,
  finishRttMs: finish.elapsedMs,
  sessionStartedAt: session.startedAt,
  startSentWall: start.sentWall,
  startRecvWall: start.recvWall,
  finishSentWall: finish.sentWall,
  finishRecvWall: finish.recvWall,
  clientGapStartToFinishSendMs: finish.sentWall - session.startedAt,
  submittedCount: 1,
  attempt: {
    solved: a.solved,
    total: a.total,
    score: a.score,
    timeRemaining: a.timeRemaining,
    speedBonus: a.scoreBreakdown?.speedBonus,
    exploits: Array.isArray(a.exploits) ? a.exploits.map((e: any) => e.id) : []
  }
}));
client.close();

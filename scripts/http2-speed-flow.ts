import { promises as fs } from "node:fs";
import http2 from "node:http2";
import { performance } from "node:perf_hooks";

import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";
import { buildCookieHeader } from "../src/level1/api.js";
import { STORAGE_STATE_PATH, TARGET_URL } from "../src/recon/capture.js";

const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const fingerprintHints = JSON.parse(await fs.readFile(process.env.CHEETCODE_FINGERPRINT_HINTS_PATH ?? "recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json", "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const baseHeaders = {
  cookie,
  "x-client-fingerprint": fingerprintHints.fingerprintId,
  referer: TARGET_URL,
  "content-type": "application/json",
  "user-agent": "cheetcode-h2-investigation/1.0",
};

type H2Result<T> = { body: T; status: number; sentWall: number; recvWall: number; elapsedMs: number };

function request<T>(client: http2.ClientHttp2Session, endpoint: string, method: string, body?: unknown): Promise<H2Result<T>> {
  return new Promise((resolve, reject) => {
    const sentWall = Date.now();
    const started = performance.now();
    const req = client.request({ ":method": method, ":path": endpoint, ":authority": "ctf.firecrawl.dev", ...baseHeaders, ...(body === undefined ? {} : { "content-length": Buffer.byteLength(JSON.stringify(body)) }) });
    const chunks: Buffer[] = [];
    let status = 0;
    req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const recvWall = Date.now();
      const text = Buffer.concat(chunks).toString("utf8");
      if (status < 200 || status >= 300) return reject(new Error(`${endpoint} HTTP ${status}: ${text.slice(0, 240)}`));
      let parsed: T;
      try { parsed = JSON.parse(text) as T; } catch { parsed = text as T; }
      resolve({ body: parsed, status, sentWall, recvWall, elapsedMs: Math.round(performance.now() - started) });
    });
    if (body === undefined) req.end(); else req.end(JSON.stringify(body));
  });
}

function submissions(session: LevelSession) {
  return (session.problems as CheetProblem[]).map((p) => {
    const s = solveKnownProblem(p);
    if (!s.known) throw new Error(`No catalog answer for ${p.id}`);
    return { problemId: p.id, code: s.code };
  });
}

async function run(label: string, warm: boolean) {
  const client = http2.connect("https://ctf.firecrawl.dev");
  await new Promise<void>((resolve, reject) => { client.once("connect", () => resolve()); client.once("error", reject); });
  let warmup: H2Result<unknown> | undefined;
  if (warm) warmup = await request(client, "/", "GET");
  const start = await request<LevelSession>(client, "/api/session", "POST", { level: 1, isDev: false, fingerprintHints });
  const session = start.body;
  const finish = await request<any>(client, "/api/level-1/finish", "POST", {
    sessionId: session.sessionId,
    github: "trimaxeng2",
    timeElapsed: Math.max(0, 60_000 - (session.expiresAt - Date.now())),
    submissions: submissions(session),
  });
  const attempt = finish.body.attempt ?? {};
  const result = {
    label,
    httpVersion: client.alpnProtocol,
    warmupMs: warmup?.elapsedMs ?? null,
    startRttMs: start.elapsedMs,
    finishRttMs: finish.elapsedMs,
    startSentWall: start.sentWall,
    startRecvWall: start.recvWall,
    serverStartedAt: session.startedAt,
    finishSentWall: finish.sentWall,
    finishRecvWall: finish.recvWall,
    clientGapStartToFinishSendMs: finish.sentWall - session.startedAt,
    attempt: {
      solved: attempt.solved,
      total: attempt.total,
      score: attempt.score,
      timeRemaining: attempt.timeRemaining,
      speedBonus: attempt.scoreBreakdown?.speedBonus,
      exploits: Array.isArray(attempt.exploits) ? attempt.exploits.map((e: any) => e.id) : [],
    },
  };
  client.close();
  console.log(JSON.stringify(result));
}

const maxAttempts = Number(process.env.SPEED_DEMON_ATTEMPTS ?? "5");
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await run(`h2-warm-get-honest-elapsed-attempt-${attempt}`, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ attempt, stopped: true, reason: message.includes("HTTP 429") ? "rate_limited" : "error", detail: message.slice(0, 240) }));
    break;
  }
  if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 6_500));
}

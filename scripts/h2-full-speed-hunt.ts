// Tight persistent-HTTP/2 full-25-submission speed_demon hunt.
// The handoff proved the lever is clientDelay (session.startedAt -> finish send): its H2 one-sub flow hit
// 187ms and cleared <1s, while fetch-based flows sit at 360-730ms and don't. This replicates that tight
// flow but sends ALL 25 correct submissions + the leaked flag, so a winning finish banks the full 1270.
// It reuses ONE warm H2 connection across attempts (same server instance = warmer grading) and respects
// the strict rate limit (429 -> long cooldown, not counted).
//
//   unset CHEETCODE_GITHUB_PAT
//   CHEETCODE_GITHUB=trimaxeng2 npx tsx scripts/h2-full-speed-hunt.ts
//
// Env: H2_HUNT_MAX (default 30), H2_HUNT_SPACING_MS (default 30000), H2_HUNT_COOLDOWN_MS (default 90000).
import { promises as fs } from "node:fs";
import path from "node:path";
import http2 from "node:http2";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";
import { buildCookieHeader } from "../src/level1/api.js";
import { OUTPUT_ROOT, STORAGE_STATE_PATH, TARGET_URL } from "../src/recon/capture.js";

const github = (process.env.CHEETCODE_GITHUB || "trimaxeng2").trim();
const MAX = Number(process.env.H2_HUNT_MAX ?? 30);
const SPACING_MS = Number(process.env.H2_HUNT_SPACING_MS ?? 30000);
const COOLDOWN_MS = Number(process.env.H2_HUNT_COOLDOWN_MS ?? 90000);

const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const hints = JSON.parse(await fs.readFile(process.env.CHEETCODE_FINGERPRINT_HINTS_PATH ?? "recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json", "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const headers: Record<string, string> = {
  cookie,
  "x-client-fingerprint": hints.fingerprintId,
  referer: TARGET_URL,
  "content-type": "application/json",
  // Match the known-good H2 request shape used by the earlier 25/25 control.
  "user-agent": process.env.CHEETCODE_USER_AGENT ?? "cheetcode-h2-investigation/1.0"
};
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

let flag: string | undefined;
try { flag = (await fs.readFile(path.join(OUTPUT_ROOT, `.flag-${github}.txt`), "utf8")).trim() || undefined; } catch { /* none */ }

type Reply<T = unknown> = { body: T; status: number; sentWall: number; recvWall: number; elapsedMs: number };
function req<T>(client: http2.ClientHttp2Session, p: string, method: string, body?: unknown, allowError = false): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const sentWall = Date.now();
    const t0 = performance.now();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const stream = client.request({ ":method": method, ":path": p, ":authority": "ctf.firecrawl.dev", ...headers, ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) });
    const chunks: Buffer[] = [];
    let status = 0;
    stream.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => {
      const recvWall = Date.now();
      const text = Buffer.concat(chunks).toString("utf8");
      if (!allowError && (status < 200 || status >= 300)) return reject(new Error(`${p} HTTP ${status}`));
      let parsed: T;
      try { parsed = JSON.parse(text) as T; } catch { parsed = text as T; }
      resolve({ body: parsed, status, sentWall, recvWall, elapsedMs: Math.round(performance.now() - t0) });
    });
    if (payload) stream.end(payload); else stream.end();
  });
}

// warm Convex (read-only) + a persistent H2 connection + the finish route
await fetch("https://moonlit-gnu-522.convex.cloud/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "leaderboard:getAll", args: { scoreVersion: 3 }, format: "json" }) }).then((r) => r.arrayBuffer());
const client = http2.connect("https://ctf.firecrawl.dev");
await new Promise<void>((resolve, reject) => { client.once("connect", () => resolve()); client.once("error", reject); });
await req(client, "/api/level-1/finish", "GET", undefined, true); // 405 warmup, ignored

console.log(`H2 full-25 hunt for ${github}; flag ${flag ? "ready" : "MISSING"}; up to ${MAX} attempts, ${SPACING_MS}ms apart\n`);

let best = -1;
let rl = 0;
for (let attempt = 1; attempt <= MAX; ) {
  try {
    const start = await req<LevelSession>(client, "/api/session", "POST", { level: 1, isDev: false, fingerprintHints: hints });
    if (start.status === 429) throw new Error("429");
    const session = start.body;
    const solved = (session.problems as CheetProblem[]).map(solveKnownProblem);
    if (solved.some((s) => !s.known)) throw new Error("unknown L1 problem in draw");
    const submissions = solved.map((s) => ({ problemId: s.problemId, code: s.code }));
    const body: Record<string, unknown> = {
      sessionId: session.sessionId,
      github,
      timeElapsed: Math.max(0, 60_000 - (session.expiresAt - Date.now())),
      submissions
    };
    if (flag) body.flag = flag;
    const finish = await req<any>(client, "/api/level-1/finish", "POST", body, true);
    if (finish.status === 429 || finish.body?.error === "rate limited") throw new Error("429");
    const a = finish.body?.attempt ?? finish.body ?? {};
    const ids: string[] = (a.exploits ?? []).map((e: any) => e?.id);
    const clientDelay = finish.sentWall - session.startedAt;
    if (a.timeRemaining > best) best = a.timeRemaining;
    // Redacted diagnostic capture (NO cookies/code/flag/prompt text) so a solved:0 rejection can be
    // diagnosed after the fact — status, scoreBreakdown and landmines reveal the finish rejection branch.
    try {
      const rec = {
        at: new Date().toISOString(), attempt, httpStatus: finish.status, error: finish.body?.error,
        attemptStatus: a.status, solved: a.solved, total: a.total, score: a.score,
        timeRemaining: a.timeRemaining, scoreBreakdown: a.scoreBreakdown,
        exploits: ids, landmines: (a.landmines ?? []).map((l: any) => l?.id ?? l), clientDelay, finishRTT: finish.elapsedMs
      };
      await fs.appendFile(path.join(OUTPUT_ROOT, `h2-hunt-${github}.log.jsonl`), JSON.stringify(rec) + "\n");
    } catch { /* best effort */ }
    const hit = ids.includes("speed_demon");
    const flagHit = ids.includes("flag_finder");
    console.log(`  #${attempt}: clientDelay=${clientDelay}ms finishRTT=${finish.elapsedMs}ms timeRemaining=${a.timeRemaining} solved=${a.solved}/${a.total} score=${a.score} exploits=[${ids.join(",")}]${hit ? "  <== SPEED DEMON!" : ""}`);
    // An exploit label is not a score: v3 can report speed_demon/flag_finder on a
    // partial or rejected finish. Only stop once the requested correctness target
    // is present alongside both exploit labels.
    if (hit && flagHit && Number(a.solved) >= 24) {
      console.log(`\n★ qualifying run on attempt ${attempt}: solved=${a.solved}/${a.total}, score=${a.score}, exploits=[${ids.join(",")}].`);
      client.close(); process.exit(0);
    }
    attempt++;
    if (attempt <= MAX) await delay(SPACING_MS);
  } catch (e) {
    if (e instanceof Error && e.message === "429") {
      rl++;
      const wait = COOLDOWN_MS * Math.min(4, rl);
      console.log(`  #${attempt}: rate limited — cooling ${Math.round(wait / 1000)}s (hit #${rl})`);
      await delay(wait);
    } else {
      console.log(`  #${attempt}: error ${e instanceof Error ? e.message : String(e)}`);
      attempt++;
      if (attempt <= MAX) await delay(SPACING_MS);
    }
  }
}
client.close();
console.log(`\nNo speed_demon. Best timeRemaining=${best} (need 59). ${best >= 59 ? "Reached 59 — keep hunting this hour." : "Never hit 59 — grading+network exceeds the 1s budget from this path right now."}`);

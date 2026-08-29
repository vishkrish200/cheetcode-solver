// Measure WHY speed_demon misses: is it client<->server clock skew, or startSession response latency?
// Captures client clock around each call and the server's session.startedAt, then finishes and reads
// timeRemaining. speed_demon needs server-measured (startedAt -> finishReceive) < 1000ms.
//
//   CHEETCODE_GITHUB=trimax-3 CHEETCODE_GITHUB_PAT="$CHEETCODE_GITHUB_PAT" \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-timing-probe.ts
//
// ponytail: diagnostic; delete after speed_demon root cause is pinned.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { LevelSession, FinishResponse, CheetProblem } from "./level1/types.js";
import { TARGET_URL, STORAGE_STATE_PATH } from "./recon/capture.js";

loadEnvFile();

const github = (process.env.CHEETCODE_GITHUB || "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB.");
const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const hintsPath = process.env.CHEETCODE_FINGERPRINT_HINTS_PATH;
const fingerprintHints = hintsPath
  ? JSON.parse(await fs.readFile(hintsPath, "utf8"))
  : buildFingerprintHints(crypto.randomBytes(16).toString("hex"), Date.now());
const headers: Record<string, string> = {
  "content-type": "application/json",
  referer: TARGET_URL,
  cookie,
  "x-client-fingerprint": fingerprintHints.fingerprintId
};
// Mirror the runner's current path: fresh cookie present => cookie auth, no Bearer. Set PROBE_USE_PAT=1 to compare.
if (process.env.PROBE_USE_PAT === "1" && process.env.CHEETCODE_GITHUB_PAT) {
  headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;
}

async function post<T>(path: string, body: unknown): Promise<{ json: T; sentAt: number; recvAt: number }> {
  const sentAt = Date.now();
  const r = await fetch(new URL(path, TARGET_URL), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  const recvAt = Date.now();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}`);
  return { json: JSON.parse(text) as T, sentAt, recvAt };
}

// --- WARM-UP: a throwaway startSession to boot the /api/session serverless function + TLS connection.
// If the real startSession right after is much faster, the 1.8s was a COLD START (warming is the fix).
const warm = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
console.log(`=== warm-up startSession round-trip=${warm.recvAt - warm.sentAt}ms (throwaway) ===`);

// --- startSession, capturing exact client clock around it ---
const ss = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const session = ss.json;
const clientMidStart = (ss.sentAt + ss.recvAt) / 2;
const startRtt = ss.recvAt - ss.sentAt;
// server stamped startedAt while handling the request; compare to the client midpoint of that request
const skew = session.startedAt - clientMidStart; // +ve => server clock AHEAD of client (client behind)

console.log("=== startSession ===");
console.log(`  client sentAt=${ss.sentAt}  recvAt=${ss.recvAt}  round-trip=${startRtt}ms`);
console.log(`  server session.startedAt=${session.startedAt}`);
console.log(`  estimated clock skew (server - client) = ${Math.round(skew)}ms  ${skew > 300 ? "<== CLIENT CLOCK IS BEHIND SERVER" : ""}`);

// --- solve (in-memory) and finish immediately ---
const solved = (session.problems as CheetProblem[]).map(solveKnownProblem);
const beforeSolve = Date.now();
const submissions = solved.map((s) => ({ problemId: s.problemId, code: s.code }));
const afterSolve = Date.now();

const fin = await post<FinishResponse>("/api/level-1/finish", {
  sessionId: session.sessionId,
  github,
  timeElapsed: Math.max(0, 60000 - (session.expiresAt - Date.now())),
  submissions
});
const a = fin.json.attempt as any;

console.log("=== finish ===");
console.log(`  solve took ${afterSolve - beforeSolve}ms`);
console.log(`  client time from server.startedAt to finish SEND = ${ss && fin.sentAt - session.startedAt}ms (client clock)`);
console.log(`  TRUE elapsed (skew-corrected) startedAt->finish send ≈ ${Math.round(fin.sentAt - session.startedAt + skew)}ms`);
console.log(`  finish round-trip=${fin.recvAt - fin.sentAt}ms`);
console.log(`  => server result: timeRemaining=${a.timeRemaining}  speedBonus=${a.scoreBreakdown?.speedBonus}  trickery=${a.scoreBreakdown?.trickeryModifier}  exploits=${JSON.stringify((a.exploits||[]).map((e:any)=>e.id))}`);
console.log("\nInterpretation: server-measured elapsed = timeRemaining≈(60 - elapsed_s). If TRUE elapsed (skew-corrected)");
console.log("is >1000ms while client-clock elapsed is <1000ms, the client clock is behind and that's why speed_demon misses.");

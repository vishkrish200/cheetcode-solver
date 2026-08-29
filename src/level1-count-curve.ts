// Map finish grading time vs submission count. The one-submission experiment proved speed_demon fires
// when the finish grades fast; the gate is gradingTime(N). This measures timeRemaining + finish RTT for
// several N to find the largest count that still clears <1s, and whether solved requires the full set.
//
//   unset CHEETCODE_GITHUB_PAT
//   CHEETCODE_GITHUB=trimaxeng2 \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-count-curve.ts
//
// Env: COUNT_CURVE_POINTS="1,10,20,25" (submission counts), COUNT_CURVE_SPACING_MS (default 30000).
// Respects the strict rate limit: cools down on 429, doesn't count it. ponytail: diagnostic; delete after.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints, elapsedForSession } from "./level1/api.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { LevelSession, FinishResponse, CheetProblem } from "./level1/types.js";
import { TARGET_URL, STORAGE_STATE_PATH } from "./recon/capture.js";

loadEnvFile();

const github = (process.env.CHEETCODE_GITHUB || "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB.");
const POINTS = (process.env.COUNT_CURVE_POINTS ?? "1,10,20,25").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const SPACING_MS = Number(process.env.COUNT_CURVE_SPACING_MS ?? 30000);

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
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

// minify catalog code to shrink upload (whitespace only; semantics unchanged)
const minify = (code: string) => code.replace(/\s+/g, " ").trim();

async function post<T>(urlPath: string, body: unknown): Promise<{ json: T; rtt: number }> {
  const t0 = Date.now();
  const r = await fetch(new URL(urlPath, TARGET_URL), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  const rtt = Date.now() - t0;
  if (r.status === 429) throw new Error(`${urlPath} 429`);
  if (!r.ok) throw new Error(`${urlPath} ${r.status}: ${text.slice(0, 150)}`);
  return { json: JSON.parse(text) as T, rtt };
}

async function measure(n: number): Promise<void> {
  const ss = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
  const session = ss.json;
  const solved = (session.problems as CheetProblem[]).map(solveKnownProblem);
  const subs = solved.slice(0, n).map((s) => ({ problemId: s.problemId, code: minify(s.code) }));
  const sendAt = Date.now();
  const fin = await post<FinishResponse>("/api/level-1/finish", {
    sessionId: session.sessionId,
    github,
    timeElapsed: elapsedForSession(session),
    submissions: subs
  });
  const a = fin.json.attempt as any;
  const ids: string[] = (a.exploits ?? []).map((e: any) => e?.id);
  const clientDelay = sendAt - session.startedAt;
  console.log(
    `  N=${String(n).padStart(2)}  finishRTT=${String(fin.rtt).padStart(4)}ms  clientDelay=${clientDelay}ms  ` +
    `timeRemaining=${a.timeRemaining}  solved=${a.solved}/${a.total}  score=${a.score}  ` +
    `speed_demon=${ids.includes("speed_demon")}`
  );
}

console.log(`Mapping grading cost vs submission count for ${github}: N=[${POINTS.join(",")}], ${SPACING_MS}ms apart\n`);
for (let i = 0; i < POINTS.length; i++) {
  const n = POINTS[i];
  for (let tries = 0; tries < 6; tries++) {
    try {
      await measure(n);
      break;
    } catch (e) {
      if (e instanceof Error && / 429$/.test(e.message)) {
        console.log(`  N=${n}: rate limited — cooling 90s`);
        await delay(90000);
        continue;
      }
      console.log(`  N=${n}: error ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  if (i < POINTS.length - 1) await delay(SPACING_MS);
}
console.log("\nRead: the largest N with speed_demon=true (or timeRemaining=59) is the count budget. If even N=25 shows 59 sometimes, off-peak + compact payload can win; if 25 is always 58 while low N is 59, the fixed cost is grading 25 and only co-location closes it. Also note whether solved>0 for N<25 (does scoring need the full set).");

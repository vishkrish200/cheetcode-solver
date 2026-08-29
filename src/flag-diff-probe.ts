/**
 * Flag Diff Probe — reads scoreSnapshot before and after /api/leads submissions
 * to determine whether a given flag value causes a score increase.
 *
 * Usage:
 *   npm run flag:diff -- "flag{candidate1}" "flag{candidate2}"
 *   FLAG_PROBE_EMAIL=me@example.com npm run flag:diff -- "flag{candidate}"
 *
 * For each candidate the probe:
 *   1. Reads current scoreSnapshot via POST /api/session (L1 start, immediately abandoned)
 *   2. Submits /api/leads with the candidate flag
 *   3. Waits 2 s for Convex to process
 *   4. Reads scoreSnapshot again
 *   5. Reports the ELO delta
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { loadEnvFile } from "./env.js";
import { resolveGithubIdentity } from "./identity.js";
import { buildCookieHeader, buildFingerprintHints } from "./level1/api.js";
import { OUTPUT_ROOT, STORAGE_STATE_PATH, TARGET_URL } from "./recon/capture.js";

loadEnvFile();

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface StorageState {
  cookies: StorageCookie[];
  origins: unknown[];
}

interface ScoreSnapshot {
  elo: number;
  rank: number;
  score: number;
  solved: number;
}

interface SessionResponse {
  sessionId: string;
  level: number;
  scoreSnapshot?: ScoreSnapshot;
  startedAt?: number;
  expiresAt?: number;
  problems?: unknown[];
}

interface LeadsResponse {
  ok: boolean;
  upserted?: string;
}

interface ProbeResult {
  flag: string;
  eloBefore: number;
  rankBefore: number;
  eloAfter: number;
  rankAfter: number;
  eloDelta: number;
  leadsStatus: number;
  leadsBody: string;
}

async function readCookie(): Promise<string> {
  const baseUrl = new URL(TARGET_URL);
  const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
  const cookie = buildCookieHeader(storage.cookies, baseUrl.hostname);
  if (!cookie) throw new Error(`No cookies for ${baseUrl.hostname} in ${STORAGE_STATE_PATH}. Run: npm run recon -- auth:comet`);
  return cookie;
}

async function readScoreSnapshot(cookie: string, fingerprintId: string): Promise<ScoreSnapshot> {
  const hints = buildFingerprintHints(fingerprintId, Date.now());
  const response = await fetch(new URL("/api/session", TARGET_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      referer: TARGET_URL,
      cookie,
      "x-client-fingerprint": fingerprintId
    },
    body: JSON.stringify({
      level: 1,
      isDev: false,
      fingerprintHints: hints
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /api/session failed ${response.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text) as SessionResponse;
  const snap = data.scoreSnapshot;
  if (!snap) throw new Error("No scoreSnapshot in session response");
  return snap;
}

async function getSessionId(cookie: string, fingerprintId: string): Promise<string> {
  const hints = buildFingerprintHints(fingerprintId, Date.now());
  const response = await fetch(new URL("/api/session", TARGET_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      referer: TARGET_URL,
      cookie,
      "x-client-fingerprint": fingerprintId
    },
    body: JSON.stringify({ level: 1, isDev: false, fingerprintHints: hints })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /api/session failed ${response.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text) as SessionResponse;
  return data.sessionId;
}

async function submitLeads(
  cookie: string,
  fingerprintId: string,
  flag: string,
  github: string,
  email: string,
  sessionId: string
): Promise<{ status: number; body: string }> {
  const response = await fetch(new URL("/api/leads", TARGET_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="148", "Not/A)Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      referer: TARGET_URL,
      cookie,
      "x-client-fingerprint": fingerprintId
    },
    body: JSON.stringify({
      github,
      email,
      xHandle: "",
      flag,
      sessionId
    })
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function main(): Promise<void> {
  const candidates = process.argv.slice(2).filter((arg) => arg.startsWith("flag{"));
  if (candidates.length === 0) {
    console.log(`Usage: npm run flag:diff -- "flag{candidate1}" "flag{candidate2}" ...

This probe:
  1. Reads current ELO via POST /api/session
  2. Submits /api/leads with each flag candidate
  3. Waits 2 s for Convex to process
  4. Reads ELO again
  5. Reports the delta

Environment:
  FLAG_PROBE_EMAIL=me@example.com   (required for /api/leads)
  FLAG_PROBE_GITHUB=trimaxeng2      (optional, defaults to value in cookie)
  CHEETCODE_GITHUB=trimaxeng2       (fallback)
`);
    return;
  }

  const email = process.env.FLAG_PROBE_EMAIL ?? process.env.SUBMIT_DETAILS_EMAIL;
  const github = resolveGithubIdentity(process.env.FLAG_PROBE_GITHUB ?? process.env.CHEETCODE_GITHUB);

  if (!email) {
    throw new Error("FLAG_PROBE_EMAIL is required. Set it to your email address.");
  }

  const cookie = await readCookie();
  const results: ProbeResult[] = [];

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(OUTPUT_ROOT, `${stamp}-flag-diff-probe`);
  await fs.mkdir(runDir, { recursive: true });

  for (const candidate of candidates) {
    const fingerprintId = crypto.randomBytes(16).toString("hex");
    console.log(`\nTesting: ${candidate}`);

    // Step 1: read current score
    const before = await readScoreSnapshot(cookie, fingerprintId);
    console.log(`  Before: ELO=${before.elo} rank=${before.rank}`);

    // Step 2: get a fresh sessionId (leads API requires one) and submit
    const sessionId = await getSessionId(cookie, crypto.randomBytes(16).toString("hex"));
    const leadsResult = await submitLeads(cookie, fingerprintId, candidate, github, email, sessionId);
    console.log(`  /api/leads: HTTP ${leadsResult.status} body=${leadsResult.body.slice(0, 120)}`);

    // Step 3: wait for Convex to process
    await delay(2_500);

    // Step 4: read score again
    const after = await readScoreSnapshot(cookie, crypto.randomBytes(16).toString("hex"));
    console.log(`  After:  ELO=${after.elo} rank=${after.rank}`);

    const delta = after.elo - before.elo;
    console.log(`  Delta:  ${delta >= 0 ? "+" : ""}${delta} ${delta === 250 ? "🎉 FLAG CORRECT!" : delta !== 0 ? "(unexpected delta)" : "(no change)"}`);

    results.push({
      flag: candidate,
      eloBefore: before.elo,
      rankBefore: before.rank,
      eloAfter: after.elo,
      rankAfter: after.rank,
      eloDelta: delta,
      leadsStatus: leadsResult.status,
      leadsBody: leadsResult.body
    });

    // Small gap between candidates
    if (candidates.indexOf(candidate) < candidates.length - 1) {
      await delay(1_000);
    }
  }

  await fs.writeFile(path.join(runDir, "results.json"), JSON.stringify({ github, email: "redacted", candidates, results }, null, 2));

  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    const verdict = r.eloDelta === 250 ? "✅ CORRECT" : r.eloDelta !== 0 ? `⚠️  delta=${r.eloDelta}` : "❌ no change";
    console.log(`  ${r.flag}: ${verdict}`);
  }
  console.log(`Artifacts: ${runDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

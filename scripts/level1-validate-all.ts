// Read-only correctness diagnostic: validate the catalog answers for one fresh L1
// session without calling /api/level-1/finish. Never prints code, flags, or raw
// server responses; stop immediately if the API rate-limits validation.
import { promises as fs } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { solveKnownProblem } from "../src/level1/solutions.js";
import { buildCookieHeader } from "../src/level1/api.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";
import { STORAGE_STATE_PATH, TARGET_URL } from "../src/recon/capture.js";

const github = (process.env.CHEETCODE_GITHUB ?? "").trim();
if (!github) throw new Error("Set CHEETCODE_GITHUB.");
const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8"));
const hints = JSON.parse(await fs.readFile(
  process.env.CHEETCODE_FINGERPRINT_HINTS_PATH ?? "recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json",
  "utf8"
));
const cookie = buildCookieHeader(storage.cookies, new URL(TARGET_URL).hostname);
const headers = {
  cookie,
  "x-client-fingerprint": hints.fingerprintId,
  referer: TARGET_URL,
  "content-type": "application/json"
};
const spacingMs = Number(process.env.L1_VALIDATE_SPACING_MS ?? 100);

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, TARGET_URL), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as T;
}

const session = await post<LevelSession>("/api/session", {
  level: 1,
  isDev: false,
  fingerprintHints: hints
});
const results: Array<{ id: string; passed: boolean; known: boolean }> = [];
let rateLimited = false;
for (const problem of session.problems as CheetProblem[]) {
  const solved = solveKnownProblem(problem);
  if (!solved.known) {
    results.push({ id: problem.id, passed: false, known: false });
    continue;
  }
  try {
    const result = await post<{ passed?: boolean }>("/api/level-1/validate", {
      sessionId: session.sessionId,
      problemId: solved.problemId,
      code: solved.code
    });
    results.push({ id: problem.id, passed: result.passed === true, known: true });
  } catch (error) {
    if (error instanceof Error && error.message === "HTTP 429") rateLimited = true;
    results.push({ id: problem.id, passed: false, known: true });
    if (rateLimited) break;
  }
  if (spacingMs > 0) await delay(spacingMs);
}

console.log(JSON.stringify({
  github,
  sessionProblemCount: session.problems.length,
  checked: results.length,
  known: results.filter((r) => r.known).length,
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => r.known && !r.passed).map((r) => r.id),
  unknown: results.filter((r) => !r.known).map((r) => r.id),
  rateLimited
}));

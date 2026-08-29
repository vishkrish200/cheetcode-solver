import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";

const root = process.cwd();
const outDir = path.join(root, "output", "playwright", "speed-demon-2026-08-28");
await fs.mkdir(outDir, { recursive: true });
const harPath = path.join(outDir, "browser-speed-flow.har");
const timelinePath = path.join(outDir, "browser-speed-flow.timeline.json");
const storageState = path.join(root, "recon-output", "storage-state.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState,
  viewport: { width: 1456, height: 901 },
  screen: { width: 1512, height: 982 },
  deviceScaleFactor: 2,
  locale: "en-US",
  timezoneId: "Asia/Calcutta",
  recordHar: { path: harPath, mode: "full", content: "embed" },
});
const page = await context.newPage();
const events: Array<Record<string, unknown>> = [];
const starts = new Map<string, { method: string; url: string; start: number; headers: Record<string, string> }>();
const responseStatuses = new Map<string, number>();
page.on("response", (response) => {
  const req = response.request();
  responseStatuses.set(req.url() + "|" + req.method() + "|" + req.postData(), response.status());
});
for (const event of ["request", "requestfinished", "requestfailed"] as const) {
  page.on(event, (item: any) => {
    const req = item;
    const url = req.url();
    if (!url.includes("/api/")) return;
    if (event === "request") {
      starts.set(req.url() + "|" + req.method() + "|" + req.postData(), {
        method: req.method(), url, start: Date.now(), headers: req.headers(),
      });
      return;
    }
    const key = req.url() + "|" + req.method() + "|" + req.postData();
    const start = starts.get(key);
    events.push({
      event,
      method: req.method(),
      url: url.replace(/\?.*$/, ""),
      startWall: start?.start,
      endWall: Date.now(),
      elapsedMs: start ? Date.now() - start.start : undefined,
      requestHeaders: start?.headers ? Object.fromEntries(Object.entries(start.headers).filter(([k]) => !["cookie", "authorization"].includes(k.toLowerCase()))) : undefined,
      failure: event === "requestfailed" ? item.failure()?.errorText : undefined,
      responseStatus: event === "requestfinished" ? responseStatuses.get(key) : undefined,
    });
  });
}

const gotoStart = Date.now();
await page.goto("https://ctf.firecrawl.dev/", { waitUntil: "domcontentloaded" });
const sessionResponsePromise = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST", { timeout: 15000 });
await page.getByRole("button", { name: /L1 Orchestrate 60s/ }).click();
const sessionResponse = await sessionResponsePromise;
const session = await sessionResponse.json() as LevelSession;
const clickWall = Date.now();

const solved = (session.problems as CheetProblem[]).map((p) => {
  const s = solveKnownProblem(p);
  if (!s.known) throw new Error(`No catalog solution for ${p.id}`);
  return { problemId: p.id, code: s.code };
});
// Use the app's authenticated browser fetch, with the same endpoint/body shape as its finishGame callback.
const finishStartWall = Date.now();
const finishResult = await page.evaluate(async ({ sessionId, submissions }) => {
  const res = await fetch("/api/level-1/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, github: "trimaxeng2", timeElapsed: 1, submissions }),
  });
  return { status: res.status, body: await res.json() };
}, { sessionId: session.sessionId, submissions: solved });
const finishEndWall = Date.now();

await context.close();
await browser.close();

const attempt = (finishResult.body as any)?.attempt ?? {};
const summary = {
  gotoStart,
  clickWall,
  finishStartWall,
  finishEndWall,
  browserGapMs: finishStartWall - session.startedAt,
  session: {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    scoreSnapshot: session.scoreSnapshot,
    level: session.level,
    problemCount: session.problems.length,
  },
  finish: {
    httpStatus: finishResult.status,
    elapsedMs: finishEndWall - finishStartWall,
    solved: attempt.solved,
    total: attempt.total,
    score: attempt.score,
    timeRemaining: attempt.timeRemaining,
    speedBonus: attempt.scoreBreakdown?.speedBonus,
    exploits: Array.isArray(attempt.exploits) ? attempt.exploits.map((e: any) => e.id) : [],
  },
  apiEvents: events.filter((e) => String(e.url).includes("/api/session") || String(e.url).includes("/api/level-1/finish")),
  harPath,
};
await fs.writeFile(timelinePath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium } from "playwright";

import { analyzeRun, buildEndpointSummaries, renderEndpointSummaryMarkdown } from "./recon/analyze.js";
import { exportCometStorageState } from "./recon/comet.js";
import {
  OUTPUT_ROOT,
  STORAGE_STATE_PATH,
  TARGET_URL,
  captureAuthenticatedApp,
  capturePageState,
  createRunDir
} from "./recon/capture.js";
import type { NetworkRecord } from "./recon/types.js";

const command = process.argv[2];
const arg = process.argv[3];

async function main(): Promise<void> {
  switch (command) {
    case "auth":
      await auth();
      return;
    case "auth:comet":
      await authComet();
      return;
    case "cold":
      await cold();
      return;
    case "sacrifice":
      await sacrifice();
      return;
    case "analyze":
      await analyze(arg);
      return;
    case "help":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown recon command: ${command}`);
  }
}

async function authComet(): Promise<void> {
  const runDir = await exportCometStorageState();
  console.log(`Imported Comet cookies into ${STORAGE_STATE_PATH}`);
  console.log(`Comet auth artifacts: ${runDir}`);
}

async function auth(): Promise<void> {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const runDir = await createRunDir("auth");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await capturePageState(page, runDir, "00-auth-opened");

  const rl = createInterface({ input, output });
  await rl.question(
    [
      "",
      "Complete GitHub OAuth in the opened browser.",
      "When the CheetCode app is loaded and authenticated, press Enter here to save storage state.",
      ""
    ].join("\n")
  );
  rl.close();

  await context.storageState({ path: STORAGE_STATE_PATH });
  await capturePageState(page, runDir, "01-auth-saved");
  await fs.writeFile(
    path.join(runDir, "metadata.json"),
    `${JSON.stringify(
      {
        command: "auth",
        targetUrl: TARGET_URL,
        runDir,
        startedAt: new Date().toISOString(),
        finalUrl: page.url(),
        title: await page.title().catch(() => undefined),
        storageStatePath: STORAGE_STATE_PATH
      },
      null,
      2
    )}\n`
  );

  await browser.close();
  console.log(`Saved auth state: ${STORAGE_STATE_PATH}`);
  console.log(`Auth artifacts: ${runDir}`);
}

async function cold(): Promise<void> {
  const observeMs = Number(process.env.RECON_COLD_MS ?? 10_000);
  const runDir = await captureAuthenticatedApp({ command: "cold", observeMs });
  console.log(`Cold capture written to ${runDir}`);
}

async function sacrifice(): Promise<void> {
  const observeMs = Number(process.env.RECON_SACRIFICE_MS ?? 75_000);
  const screenshotEveryMs = Number(process.env.RECON_SCREENSHOT_EVERY_MS ?? 5_000);
  const runDir = await captureAuthenticatedApp({ command: "sacrifice", observeMs, screenshotEveryMs });
  console.log(`Sacrifice capture written to ${runDir}`);
}

async function analyze(runPath?: string): Promise<void> {
  const runDirs = runPath ? [path.resolve(runPath)] : await findCapturedRunDirs();
  if (runDirs.length === 0) {
    throw new Error(`No captured runs found under ${OUTPUT_ROOT}`);
  }

  const allRecords: NetworkRecord[] = [];
  for (const runDir of runDirs) {
    const networkPath = path.join(runDir, "network.json");
    const exists = await fileExists(networkPath);
    if (!exists) continue;
    const summaries = await analyzeRun(runDir);
    const records = JSON.parse(await fs.readFile(networkPath, "utf8")) as NetworkRecord[];
    allRecords.push(...records);
    console.log(`Analyzed ${runDir}`);
    printEndpointTable(summaries);
  }

  if (!runPath && allRecords.length > 0) {
    const combined = buildEndpointSummaries(allRecords);
    await fs.writeFile(path.join(OUTPUT_ROOT, "combined-endpoint-summary.json"), `${JSON.stringify(combined, null, 2)}\n`);
    await fs.writeFile(path.join(OUTPUT_ROOT, "combined-endpoint-summary.md"), renderEndpointSummaryMarkdown("combined", combined));
    console.log(`Combined summary written to ${path.join(OUTPUT_ROOT, "combined-endpoint-summary.md")}`);
  }
}

async function findCapturedRunDirs(): Promise<string[]> {
  const exists = await fileExists(OUTPUT_ROOT);
  if (!exists) return [];

  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(OUTPUT_ROOT, entry.name))
    .sort();
}

function printEndpointTable(summaries: ReturnType<typeof buildEndpointSummaries>): void {
  for (const summary of summaries) {
    console.log(
      `${String(summary.count).padStart(3, " ")}  ${summary.statuses.join(",") || "---"}  ${summary.tags.join(",")}  ${summary.key}`
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run recon -- auth       Open headed browser, complete GitHub OAuth, save storage state.
  npm run recon -- auth:comet Import Firecrawl/GitHub auth cookies from the local Comet profile.
  npm run recon -- cold       Authenticated capture without clicking orchestrate.
  npm run recon -- sacrifice  Click orchestrate and record the timed run.
  npm run recon -- analyze    Summarize network captures.

Environment:
  CHEETCODE_URL                 Default: ${TARGET_URL}
  RECON_OUTPUT_DIR              Default: ${OUTPUT_ROOT}
  HEADED=1                      Run non-auth captures in a visible browser.
  RECON_COLD_MS=10000           Cold capture observation window.
  RECON_SACRIFICE_MS=75000      Sacrifice capture observation window.
  RECON_SCREENSHOT_EVERY_MS=5000
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import path from "node:path";

import type { Page } from "playwright";

import type { Level3RenderedContext } from "./llm.js";
import type { Level3Session } from "./types.js";
import { writeJson } from "../level1/api.js";
import {
  TARGET_URL,
  capturePageState,
  createAuthedContext,
  launchBrowser,
  startNetworkRecorder
} from "../recon/capture.js";
import { redactText } from "../recon/redact.js";
import type { NetworkRecord } from "../recon/types.js";

export interface Level3UiSessionStart {
  session: Level3Session;
  renderedContext: Level3RenderedContext;
  fingerprintId?: string;
}

export async function startLevel3SessionViaUi(runDir: string): Promise<Level3UiSessionStart> {
  const browser = await launchBrowser();
  try {
    const context = await createAuthedContext(browser);
    const recorder = startNetworkRecorder(context);
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await capturePageState(page, runDir, "ui-00-dashboard");

    let prestartText: string | undefined;
    if (!(await pageContains(page, /Compiler Ready|Start Level 3|Paste code|Behavior Bucket/i))) {
      await clickMatchingControl(page, /L3|Build|Level 3/i, "Level 3 dashboard entry");
      await waitForLevel3Prestart(page);
    }

    if (await pageContains(page, /Level 3: Compiler Readiness|Recommended Diagnostic/i)) {
      await waitForLevel3Prestart(page);
    }

    if (await pageContains(page, /Compiler Ready|Start Level 3|Recommended Diagnostic/i)) {
      prestartText = await readBodyText(page);
      await capturePageState(page, runDir, "ui-01-level3-prestart");
      await clickMatchingControl(page, /Compiler Ready|Start Level 3|Start/i, "Level 3 start button");
    }

    await waitForRenderedChallenge(page);
    await capturePageState(page, runDir, "ui-02-rendered-level3");

    const renderedChallengeText = await readBodyText(page);
    const fingerprintId = await page
      .evaluate(() => localStorage.getItem("ctf:fp:visitor-id") ?? undefined)
      .catch(() => undefined);

    await recorder.writeTo(path.join(runDir, "ui-session-network.json"));
    const session =
      extractLevel3UiSessionFromNetworkRecords(recorder.records) ?? (await readLevel3SessionFromLocalStorage(page));
    if (!session) {
      throw new Error("Could not extract Level 3 session from UI network records or localStorage snapshot.");
    }

    const renderedContext = { prestartText, renderedChallengeText };
    await writeJson(path.join(runDir, "ui-rendered-context.json"), {
      prestartText: prestartText ? redactText(prestartText) : undefined,
      renderedChallengeText: redactText(renderedChallengeText),
      fingerprintId
    });
    await context.close();

    return { session, renderedContext, fingerprintId };
  } finally {
    await browser.close();
  }
}

export function extractLevel3UiSessionFromNetworkRecords(records: NetworkRecord[]): Level3Session | undefined {
  const sessionRecords = records.filter(
    (record) => record.method === "POST" && record.url.includes("/api/session") && record.responseBodyPreview
  );
  for (const record of sessionRecords.reverse()) {
    const parsed = parseLevel3Session(record.responseBodyPreview);
    if (parsed) return parsed;
  }
  return undefined;
}

async function readLevel3SessionFromLocalStorage(page: Page): Promise<Level3Session | undefined> {
  const snapshot = await page
    .evaluate(() => localStorage.getItem("cheetcode.v1.sessionSnapshot") ?? undefined)
    .catch(() => undefined);
  return parseLevel3Session(snapshot);
}

function parseLevel3Session(text: string | undefined): Level3Session | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as Level3Session;
    if (parsed.level === 3 && parsed.problems?.[0]) return parsed;
  } catch {
    // Try the next possible source.
  }
  return undefined;
}

async function clickMatchingControl(page: Page, pattern: RegExp, description: string): Promise<void> {
  const locator = page.locator("button, a, [role='button']").filter({ hasText: pattern });
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ timeout: 5_000 });
      return;
    }
  }
  throw new Error(`Could not find visible ${description}.`);
}

async function pageContains(page: Page, pattern: RegExp): Promise<boolean> {
  const bodyText = await readBodyText(page).catch(() => "");
  return pattern.test(bodyText);
}

async function readBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function waitForLevel3Prestart(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return body.length > 200 && /Compiler Ready,? Start Level 3|Start Level 3/i.test(body) && !/Loading your next Level 3 challenge details/i.test(body);
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

async function waitForRenderedChallenge(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return /Paste code|Behavior Bucket|main\\.(c|cpp|rs)|Submit/i.test(body);
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

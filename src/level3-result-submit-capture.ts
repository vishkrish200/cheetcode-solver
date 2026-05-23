import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Browser, BrowserContext, Page } from "playwright";

import { loadEnvFile } from "./env.js";
import { writeJson } from "./level1/api.js";
import {
  capturePageState,
  createRunDir,
  launchBrowser,
  startNetworkRecorder,
  TARGET_URL
} from "./recon/capture.js";

loadEnvFile();

const DEFAULT_CHECKPOINT = path.resolve(
  "recon-output/2026-05-21T18-flag-forensics/victory-rehydrate/victory-state.json"
);
const DEFAULT_AUTH_STATE = path.resolve("recon-output/storage-state.json");
const VIEWPORT = { width: 1440, height: 1000 };

interface SnapshotInput {
  index: number;
  type: string;
  placeholder: string;
  value: string;
  readOnly: boolean;
  disabled: boolean;
  ariaLabel: string | null;
  outerHTML: string;
}

interface SnapshotButton {
  index: number;
  text: string;
  disabled: boolean;
  outerHTML: string;
}

interface DomSnapshot {
  url: string;
  title: string;
  bodyText: string;
  inputs: SnapshotInput[];
  buttons: SnapshotButton[];
  localStorage: Record<string, string>;
}

async function main(): Promise<void> {
  const checkpointPath = path.resolve(process.env.RESULTS_CHECKPOINT ?? DEFAULT_CHECKPOINT);
  const submitAllowed = process.env.SUBMIT_DETAILS_ALLOW_SEND === "1";
  const submitEmail = process.env.SUBMIT_DETAILS_EMAIL;
  const submitX = process.env.SUBMIT_DETAILS_X ?? "";
  const submitFlag = process.env.SUBMIT_DETAILS_FLAG ?? "";

  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8")) as unknown;
  const restoredLocalStorage = extractLocalStorage(checkpoint);

  const runDir = await createRunDir("level3-result-submit-capture");
  await writeJson(path.join(runDir, "input.json"), {
    targetUrl: TARGET_URL,
    checkpointPath,
    submitAllowed,
    hasEmail: Boolean(submitEmail),
    hasXHandle: Boolean(submitX),
    hasFlag: Boolean(submitFlag)
  });

  const browser = await launchBrowser();
  let context: BrowserContext | undefined;

  try {
    context = await createCaptureContext(browser);
    const recorder = startNetworkRecorder(context);
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((items) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(key, value);
      }
    }, restoredLocalStorage);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await waitForResultsScreen(page);

    await snapshot(page, runDir, "00-restored-before-submit");
    await recorder.writeTo(path.join(runDir, "network-before-submit.json"));

    if (!submitAllowed) {
      await writeJson(path.join(runDir, "submit-skipped.json"), {
        reason: "SUBMIT_DETAILS_ALLOW_SEND was not set to 1",
        nextCommand:
          "RECON_OUTPUT_DIR=output/playwright HEADED=1 SUBMIT_DETAILS_ALLOW_SEND=1 SUBMIT_DETAILS_EMAIL='you@example.com' SUBMIT_DETAILS_X='@handle' npx tsx src/level3-result-submit-capture.ts"
      });
      await recorder.writeTo(path.join(runDir, "network.json"));
      console.log(`Restored result screen and captured pre-submit state: ${runDir}`);
      console.log("Submit skipped: set SUBMIT_DETAILS_ALLOW_SEND=1 and SUBMIT_DETAILS_EMAIL to send the visible details form.");
      return;
    }

    if (!submitEmail) {
      throw new Error("SUBMIT_DETAILS_EMAIL is required when SUBMIT_DETAILS_ALLOW_SEND=1.");
    }

    const leadResponsePromise = page
      .waitForResponse((response) => response.url().includes("/api/leads"), { timeout: 20_000 })
      .catch(() => undefined);

    await fillSubmitForm(page, submitEmail, submitX, submitFlag);
    await snapshot(page, runDir, "01-filled-before-click");
    await page.getByRole("button", { name: /submit details/i }).click({ timeout: 10_000 });

    const leadResponse = await leadResponsePromise;
    if (leadResponse) {
      const leadText = await leadResponse.text().catch((error: unknown) => `could not read response body: ${String(error)}`);
      await writeJson(path.join(runDir, "lead-response.json"), {
        url: leadResponse.url(),
        status: leadResponse.status(),
        bodyPreview: leadText.slice(0, 5_000)
      });
    } else {
      await writeJson(path.join(runDir, "lead-response.json"), {
        error: "No /api/leads response observed within timeout."
      });
    }

    await waitForPostSubmitUi(page);
    await snapshot(page, runDir, "02-after-submit");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await snapshot(page, runDir, "03-after-submit-reload");

    await recorder.writeTo(path.join(runDir, "network.json"));
    await writeJson(path.join(runDir, "lead-network-records.json"), recorder.records.filter((record) => record.url.includes("/api/leads")));
    console.log(`Submitted visible details form and captured evidence: ${runDir}`);
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close();
  }
}

async function createCaptureContext(browser: Browser): Promise<BrowserContext> {
  const authStatePath = path.resolve(process.env.AUTH_STORAGE_STATE_PATH ?? DEFAULT_AUTH_STATE);
  try {
    await fs.access(authStatePath);
  } catch {
    throw new Error(`Missing auth state at ${authStatePath}. Run: npm run recon -- auth`);
  }

  return browser.newContext({
    storageState: authStatePath,
    viewport: VIEWPORT
  });
}

function extractLocalStorage(value: unknown): Record<string, string> {
  if (!isRecord(value) || !isRecord(value.localStorage)) {
    throw new Error("Checkpoint does not contain a localStorage object.");
  }

  return Object.fromEntries(
    Object.entries(value.localStorage).map(([key, rawValue]) => [
      key,
      typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue)
    ])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForResultsScreen(page: Page): Promise<void> {
  await page.locator('input[placeholder="flag{...}"]').waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: /submit details/i }).waitFor({ timeout: 20_000 });
}

async function fillSubmitForm(page: Page, email: string, xHandle: string, flag: string): Promise<void> {
  await page.locator('input[placeholder="agent@company.com"], input[placeholder="you@company.com"]').first().fill(email);

  const xInput = page.locator('input[placeholder="@handle"]').first();
  if ((await xInput.count()) > 0) {
    await xInput.fill(xHandle);
  }

  const flagInput = page.locator('input[placeholder="flag{...}"]').first();
  if ((await flagInput.count()) > 0) {
    await flagInput.fill(flag);
  }
}

async function waitForPostSubmitUi(page: Page): Promise<void> {
  await Promise.race([
    page.getByText(/details received|submitted|thank/i).waitFor({ timeout: 15_000 }),
    delay(5_000)
  ]).catch(() => undefined);
}

async function snapshot(page: Page, runDir: string, label: string): Promise<void> {
  await capturePageState(page, runDir, label);
  await writeJson(path.join(runDir, `${label}-snapshot.json`), await collectDomSnapshot(page));
}

async function collectDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((input, index) => ({
      index,
      type: input.type,
      placeholder: input.placeholder,
      value: input.value,
      readOnly: input.readOnly,
      disabled: input.disabled,
      ariaLabel: input.getAttribute("aria-label"),
      outerHTML: input.outerHTML
    }));
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).map((button, index) => ({
      index,
      text: button.innerText || button.textContent || "",
      disabled: button.disabled,
      outerHTML: button.outerHTML
    }));
    const localStorageEntries: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) localStorageEntries[key] = localStorage.getItem(key) ?? "";
    }

    return {
      url: location.href,
      title: document.title,
      bodyText: document.body.innerText,
      inputs,
      buttons,
      localStorage: localStorageEntries
    };
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

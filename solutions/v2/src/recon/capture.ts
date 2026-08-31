import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright";

import { loadEnvFile } from "../env.js";
import { redactHeaders, redactText } from "./redact.js";
import type { NetworkRecord, RunMetadata } from "./types.js";

// Importers use these constants before their own entrypoint bodies execute.
loadEnvFile();

export const TARGET_URL = process.env.CHEETCODE_URL ?? "https://ctf.firecrawl.dev/";
export const OUTPUT_ROOT = path.resolve(process.env.RECON_OUTPUT_DIR ?? "recon-output");
export const STORAGE_STATE_PATH = path.resolve(process.env.AUTH_STORAGE_STATE_PATH ?? path.join(OUTPUT_ROOT, "storage-state.json"));

const MAX_BODY_BYTES = Number(process.env.RECON_MAX_BODY_BYTES ?? 64_000);
const MAX_WS_FRAME_BYTES = Number(process.env.RECON_MAX_WS_FRAME_BYTES ?? 16_000);
const MAX_WS_FRAMES_PER_SOCKET = Number(process.env.RECON_MAX_WS_FRAMES_PER_SOCKET ?? 250);
const VIEWPORT = { width: 1440, height: 1000 };

interface CapturedWebSocketFrame {
  payload: string | Buffer;
  opcode?: number;
}

export interface CaptureOptions {
  command: "cold" | "sacrifice";
  observeMs: number;
  screenshotEveryMs?: number;
}

export async function launchBrowser(): Promise<Browser> {
  const headless = process.env.HEADED === "1" ? false : process.env.HEADLESS !== "0";
  return chromium.launch({ headless });
}

export async function createAuthedContext(browser: Browser): Promise<BrowserContext> {
  await assertFileExists(STORAGE_STATE_PATH, `Missing auth state at ${STORAGE_STATE_PATH}. Run: npm run recon -- auth`);
  return browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: VIEWPORT,
    recordHar: process.env.RECON_HAR === "1" ? { path: path.join(OUTPUT_ROOT, "latest.har") } : undefined
  });
}

export async function createRunDir(kind: string): Promise<string> {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(OUTPUT_ROOT, `${stamp}-${kind}`);
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await fs.mkdir(path.join(runDir, "dom"), { recursive: true });
  await fs.mkdir(path.join(runDir, "state"), { recursive: true });
  await fs.mkdir(path.join(runDir, "text"), { recursive: true });
  return runDir;
}

export async function capturePageState(page: Page, runDir: string, label: string): Promise<void> {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-");
  await fs.writeFile(path.join(runDir, "dom", `${safeLabel}.html`), await page.content());
  await page.screenshot({ path: path.join(runDir, "screenshots", `${safeLabel}.png`), fullPage: true });
  const state = await collectPageState(page).catch((error: unknown) => ({
    captureError: error instanceof Error ? error.message : String(error)
  }));
  await fs.writeFile(path.join(runDir, "state", `${safeLabel}.json`), `${JSON.stringify(state, null, 2)}\n`);
  if ("bodyText" in state && typeof state.bodyText === "string") {
    await fs.writeFile(path.join(runDir, "text", `${safeLabel}.txt`), redactText(state.bodyText));
  }
}

async function collectPageState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const readStorage = (storage: Storage): Record<string, string> => {
      const entries: Record<string, string> = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) entries[key] = storage.getItem(key) ?? "";
      }
      return entries;
    };

    const safeReadStorage = (name: "localStorage" | "sessionStorage"): Record<string, string> | { error: string } => {
      try {
        return readStorage(window[name]);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };

    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyText: document.body?.innerText ?? "",
      selectionText: window.getSelection()?.toString() ?? "",
      activeElement: document.activeElement
        ? {
            tagName: document.activeElement.tagName,
            text: (document.activeElement.textContent ?? "").slice(0, 2_000),
            outerHTML: document.activeElement.outerHTML.slice(0, 5_000)
          }
        : null,
      inputs: Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((input, index) => ({
        index,
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        value: input.value,
        readOnly: input.readOnly,
        disabled: input.disabled,
        ariaLabel: input.getAttribute("aria-label"),
        outerHTML: input.outerHTML.slice(0, 5_000)
      })),
      textareas: Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).map((textarea, index) => ({
        index,
        name: textarea.name,
        id: textarea.id,
        placeholder: textarea.placeholder,
        value: textarea.value,
        disabled: textarea.disabled,
        ariaLabel: textarea.getAttribute("aria-label"),
        outerHTML: textarea.outerHTML.slice(0, 5_000)
      })),
      buttons: Array.from(document.querySelectorAll<HTMLButtonElement>("button")).map((button, index) => ({
        index,
        text: button.innerText || button.textContent || "",
        disabled: button.disabled,
        ariaLabel: button.getAttribute("aria-label"),
        outerHTML: button.outerHTML.slice(0, 5_000)
      })),
      anchors: Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).map((anchor, index) => ({
        index,
        text: anchor.innerText || anchor.textContent || "",
        href: anchor.href,
        target: anchor.target,
        outerHTML: anchor.outerHTML.slice(0, 5_000)
      })),
      meta: Array.from(document.querySelectorAll<HTMLMetaElement>("meta")).map((meta, index) => ({
        index,
        name: meta.getAttribute("name"),
        property: meta.getAttribute("property"),
        content: meta.getAttribute("content")
      })),
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: "initiatorType" in entry ? String(entry.initiatorType) : undefined,
        startTime: entry.startTime,
        duration: entry.duration
      })),
      userAgent: navigator.userAgent,
      localStorage: safeReadStorage("localStorage"),
      sessionStorage: safeReadStorage("sessionStorage")
    };
  });
}

export async function captureAuthenticatedApp(options: CaptureOptions): Promise<string> {
  const runDir = await createRunDir(options.command);
  const browser = await launchBrowser();
  const metadata: RunMetadata = {
    command: options.command,
    targetUrl: TARGET_URL,
    runDir,
    startedAt: new Date().toISOString(),
    notes: []
  };

  try {
    const context = await createAuthedContext(browser);
    const recorder = startNetworkRecorder(context);
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      metadata.notes?.push("networkidle timeout after initial navigation");
    });
    await capturePageState(page, runDir, "00-initial");

    if (options.command === "sacrifice") {
      const clickResult = await clickOrchestrate(page);
      metadata.notes?.push(clickResult);
      await capturePageState(page, runDir, "01-after-orchestrate-click");
    }

    if (options.screenshotEveryMs && options.screenshotEveryMs > 0) {
      await captureTimeline(page, runDir, options.observeMs, options.screenshotEveryMs);
    } else {
      await delay(options.observeMs);
    }

    metadata.finalUrl = page.url();
    metadata.title = await page.title().catch(() => undefined);
    metadata.finishedAt = new Date().toISOString();

    await fs.writeFile(path.join(runDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await recorder.writeTo(path.join(runDir, "network.json"));
    await context.close();
  } finally {
    await browser.close();
  }

  return runDir;
}

export function startNetworkRecorder(context: BrowserContext): {
  records: NetworkRecord[];
  writeTo: (filePath: string) => Promise<void>;
} {
  const records: NetworkRecord[] = [];
  const requestIds = new WeakMap<Request, string>();
  const startedAt = new WeakMap<Request, number>();
  const pending: Promise<void>[] = [];
  let sequence = 0;

  const nextId = () => String(++sequence).padStart(5, "0");

  context.on("request", (request) => {
    const id = nextId();
    requestIds.set(request, id);
    startedAt.set(request, Date.now());
    records.push({
      id,
      type: "http",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      requestHeaders: redactHeaders(request.headers()),
      requestPostData: request.postData() ? redactText(request.postData() ?? "") : undefined,
      startedAt: new Date().toISOString()
    });
  });

  context.on("response", (response) => {
    pending.push(
      (async () => {
        const request = response.request();
        const record = findRecord(records, requestIds.get(request));
        if (!record) return;

        record.status = response.status();
        record.responseHeaders = redactHeaders(response.headers());
        record.finishedAt = new Date().toISOString();
        record.durationMs = elapsedMs(startedAt.get(request));

        const body = await safeResponseBody(response);
        if (body) {
          Object.assign(record, body);
        }
      })()
    );
  });

  context.on("requestfailed", (request) => {
    const record = findRecord(records, requestIds.get(request));
    if (!record) return;
    record.failureText = request.failure()?.errorText;
    record.finishedAt = new Date().toISOString();
    record.durationMs = elapsedMs(startedAt.get(request));
  });

  context.on("page", (page) => {
    attachWebSocketRecorder(page, records, nextId);
  });

  return {
    records,
    writeTo: async (filePath: string) => {
      await Promise.allSettled(pending);
      await fs.writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`);
    }
  };
}

export async function clickOrchestrate(page: Page): Promise<string> {
  const text = /orchestrate|start|begin|launch|go/i;

  const roleButton = page.getByRole("button", { name: text }).first();
  if ((await roleButton.count().catch(() => 0)) > 0) {
    await roleButton.click({ timeout: 5_000 });
    return "Clicked orchestrate/start button by role.";
  }

  const textTarget = page.locator("button, a, [role='button']").filter({ hasText: text }).first();
  if ((await textTarget.count().catch(() => 0)) > 0) {
    await textTarget.click({ timeout: 5_000 });
    return "Clicked orchestrate/start element by text.";
  }

  const clicked = await page.evaluate(() => {
    const pattern = /orchestrate|start|begin|launch|go/i;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button']"));
    const target = candidates.find((element) => pattern.test(element.innerText || element.textContent || ""));
    target?.click();
    return target ? `${target.tagName.toLowerCase()}: ${target.innerText || target.textContent || ""}` : null;
  });

  if (!clicked) {
    throw new Error("Could not find an orchestrate/start button to click.");
  }

  return `Clicked orchestrate/start element by DOM fallback: ${clicked}`;
}

async function captureTimeline(page: Page, runDir: string, observeMs: number, screenshotEveryMs: number): Promise<void> {
  const started = Date.now();
  let index = 1;

  while (Date.now() - started < observeMs) {
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    await capturePageState(page, runDir, `${String(index).padStart(2, "0")}-${elapsedSeconds}s`);
    index += 1;
    await delay(Math.min(screenshotEveryMs, Math.max(0, observeMs - (Date.now() - started))));
  }
}

async function safeResponseBody(response: { headers: () => Record<string, string>; body: () => Promise<Buffer> }): Promise<Partial<NetworkRecord> | undefined> {
  const headers = response.headers();
  const contentType = getHeader(headers, "content-type") ?? "";
  const shouldCapture =
    /(?:json|text|javascript|html|css|xml|graphql|x-www-form-urlencoded)/i.test(contentType) || contentType === "";

  if (!shouldCapture) return undefined;

  try {
    const buffer = await response.body();
    const truncated = buffer.byteLength > MAX_BODY_BYTES;
    const slice = buffer.subarray(0, MAX_BODY_BYTES);
    const preview = redactText(slice.toString("utf8"));
    return {
      responseBodyPreview: preview,
      responseBodyBase64: slice.toString("base64"),
      responseBodyBytes: buffer.byteLength,
      bodyTruncated: truncated
    };
  } catch {
    return undefined;
  }
}

function attachWebSocketRecorder(page: Page, records: NetworkRecord[], nextId: () => string): void {
  page.on("websocket", (socket) => {
    const record: NetworkRecord = {
      id: nextId(),
      type: "websocket",
      method: "GET",
      url: socket.url(),
      resourceType: "websocket",
      requestHeaders: {},
      startedAt: new Date().toISOString(),
      framesSent: 0,
      framesReceived: 0
    };
    records.push(record);

    socket.on("framesent", (frame) => {
      record.framesSent = (record.framesSent ?? 0) + 1;
      appendWebSocketFrame(record, "sent", frame);
    });
    socket.on("framereceived", (frame) => {
      record.framesReceived = (record.framesReceived ?? 0) + 1;
      appendWebSocketFrame(record, "received", frame);
    });
    socket.on("close", () => {
      record.finishedAt = new Date().toISOString();
    });
  });
}

function appendWebSocketFrame(record: NetworkRecord, direction: "sent" | "received", frame: CapturedWebSocketFrame): void {
  record.webSocketFrames ??= [];
  if (record.webSocketFrames.length >= MAX_WS_FRAMES_PER_SOCKET) return;

  const payload = typeof frame.payload === "string" ? Buffer.from(frame.payload, "utf8") : frame.payload;
  const slice = payload.subarray(0, MAX_WS_FRAME_BYTES);
  const isText = typeof frame.payload === "string";

  record.webSocketFrames.push({
    direction,
    at: new Date().toISOString(),
    opcode: frame.opcode,
    payloadPreview: isText ? redactText(slice.toString("utf8")) : undefined,
    payloadBase64: isText ? undefined : slice.toString("base64"),
    payloadBytes: payload.byteLength,
    truncated: payload.byteLength > MAX_WS_FRAME_BYTES
  });
}

function findRecord(records: NetworkRecord[], id: string | undefined): NetworkRecord | undefined {
  if (!id) return undefined;
  return records.find((record) => record.id === id);
}

function elapsedMs(start: number | undefined): number | undefined {
  return typeof start === "number" ? Date.now() - start : undefined;
}

function getHeader(headers: Record<string, string>, wantedName: string): string | undefined {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === wantedName.toLowerCase())?.[1];
}

async function assertFileExists(filePath: string, message: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(message);
  }
}

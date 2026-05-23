import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "playwright";

import { loadEnvFile } from "./env.js";
import { createLevel3Client } from "./level3/api.js";
import { writeJson } from "./level1/api.js";
import {
  TARGET_URL,
  capturePageState,
  createAuthedContext,
  createRunDir,
  launchBrowser,
  startNetworkRecorder
} from "./recon/capture.js";
import { redactText } from "./recon/redact.js";
import type { NetworkRecord } from "./recon/types.js";

loadEnvFile();

interface ScrollableDescriptor {
  id: string;
  tag: string;
  className: string;
  role: string | null;
  ariaLabel: string | null;
  textPreview: string;
  rect: { x: number; y: number; width: number; height: number };
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

async function main(): Promise<void> {
  const runDir = await createRunDir("level3-page-introspect");
  const github = process.env.CHEETCODE_GITHUB ?? "trimax-eng";
  const consoleLogs: unknown[] = [];
  const notes: string[] = [];
  let sessionFromUi: UiLevel3Session | undefined;
  let finish: unknown;

  const client = await createLevel3Client();
  const browser = await launchBrowser();
  try {
    const context = await createAuthedContext(browser);
    const recorder = startNetworkRecorder(context);
    const page = await context.newPage();

    page.on("console", (message) => {
      consoleLogs.push({
        type: message.type(),
        text: redactText(message.text()).slice(0, 4000)
      });
    });
    page.on("pageerror", (error) => {
      consoleLogs.push({
        type: "pageerror",
        text: redactText(error.stack ?? error.message).slice(0, 4000)
      });
    });

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      notes.push("networkidle timeout after opening dashboard");
    });
    await capturePageState(page, runDir, "00-dashboard-before-level3");
    await writeIntrospection(page, runDir, "00-dashboard-before-level3");

    await clickMatchingControl(page, /L3|Build|Level 3/i, "Level 3 dashboard entry");
    await waitForLevel3Prestart(page).catch((error: unknown) => {
      notes.push(`Level 3 prestart wait failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
      notes.push("networkidle timeout after clicking Level 3 entry");
    });
    await capturePageState(page, runDir, "01-level3-prestart");
    await writeIntrospection(page, runDir, "01-level3-prestart");

    await clickMatchingControl(page, /Compiler Ready|Start Level 3|Start/i, "Level 3 start button");
    await waitForRenderedChallenge(page).catch((error: unknown) => {
      notes.push(`challenge editor wait failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    await capturePageState(page, runDir, "02-rendered-level3");
    await writeIntrospection(page, runDir, "02-rendered-level3");

    const scrollables = await markScrollableContainers(page);
    await writeJson(path.join(runDir, "scrollables.json"), scrollables);
    await captureScrollableScreenshots(page, runDir, scrollables.slice(0, Number(process.env.LEVEL3_INTROSPECT_SCROLLABLES ?? 6)));

    await writeIntrospection(page, runDir, "03-after-scroll-captures");
    await writeJson(path.join(runDir, "console.json"), consoleLogs);
    await recorder.writeTo(path.join(runDir, "network.json"));
    sessionFromUi = extractLevel3SessionFromNetwork(recorder.records);
    if (sessionFromUi) {
      await writeJson(path.join(runDir, "session.json"), sessionFromUi);
      if (sessionFromUi.problems?.[0]) {
        await writeJson(path.join(runDir, "api-challenge.json"), sessionFromUi.problems[0]);
      }
    } else {
      notes.push("could not parse Level 3 session response from browser network");
    }
    await context.close();
  } finally {
    await browser.close();
    if (sessionFromUi?.problems?.[0]) {
      finish = await client.finishSession(sessionFromUi, sessionFromUi.problems[0].starterCode ?? "", github, 120_000).catch(
        (error: unknown) => ({
          error: error instanceof Error ? error.message : String(error)
        })
      );
      await writeJson(path.join(runDir, "finish-result.json"), finish);
    }
  }

  const challenge = sessionFromUi?.problems?.[0];
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level3-page-introspect",
    runDir,
    targetUrl: TARGET_URL,
    github,
    startMode: "ui",
    challenge: challenge
      ? {
          id: challenge.id,
          taskName: challenge.taskName,
          language: challenge.language,
          checks: challenge.checks
        }
      : undefined,
    notes
  });

  console.log(`Level 3 page introspection artifacts: ${runDir}`);
  console.log(challenge ? `${challenge.taskName} [${challenge.language}]` : "No Level 3 session payload parsed.");
}

interface UiLevel3Session {
  sessionId: string;
  startedAt?: number;
  expiresAt: number;
  level: 3;
  problems: Array<{
    id: string;
    taskName: string;
    language: string;
    spec: string;
    starterCode: string;
    checks: Array<{ id: string; name: string }>;
  }>;
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

async function waitForLevel3Prestart(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return body.length > 200 && /Compiler Ready|Start Level 3|Recommended Diagnostic|Your next Level 3 challenge|Assigned/i.test(body);
    })()`,
    undefined,
    { timeout: 30_000 }
  );
}

async function waitForRenderedChallenge(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      return /Paste code|Behavior Bucket|Reset state semantics|main\\.(c|cpp|rs)|Submit/i.test(body);
    })()`,
    undefined,
    { timeout: 20_000 }
  );
}

function extractLevel3SessionFromNetwork(records: NetworkRecord[]): UiLevel3Session | undefined {
  const sessionRecords = records.filter(
    (record) => record.method === "POST" && record.url.includes("/api/session") && record.responseBodyPreview
  );
  for (const record of sessionRecords.reverse()) {
    try {
      const parsed = JSON.parse(record.responseBodyPreview ?? "") as UiLevel3Session;
      if (parsed.level === 3 && parsed.problems?.[0]) return parsed;
    } catch {
      // Try the next matching network response.
    }
  }
  return undefined;
}

async function writeIntrospection(page: Page, runDir: string, label: string): Promise<void> {
  const raw = (await page.evaluate(`(() => {
    function textOf(element, max) {
      return ((element && element.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, max || 2000);
    }
    function attrsOf(element) {
      var result = {};
      Array.from(element.attributes || []).forEach(function(attr) {
        if (/^(id|class|role|aria-|data-|name|type|placeholder|href|src|for|title)/i.test(attr.name)) {
          result[attr.name] = String(attr.value).slice(0, 1000);
        }
      });
      return result;
    }
    function storageOf(storage) {
      var result = {};
      for (var index = 0; index < storage.length; index += 1) {
        var key = storage.key(index);
        if (key) result[key] = String(storage.getItem(key) || "").slice(0, 4000);
      }
      return result;
    }
    function query(selector, limit) {
      return Array.from(document.querySelectorAll(selector)).slice(0, limit || 200).map(function(element) {
        return { tag: element.tagName.toLowerCase(), attrs: attrsOf(element), text: textOf(element) };
      });
    }
    var codeCandidates = Array.from(document.querySelectorAll("textarea, pre, code, [contenteditable='true'], .cm-content, .view-line, .monaco-editor, [class*='editor']"))
      .slice(0, 200)
      .map(function(element) {
        return { tag: element.tagName.toLowerCase(), attrs: attrsOf(element), text: textOf(element, 8000) };
      })
      .filter(function(entry) { return entry.text || Object.keys(entry.attrs).length > 0; });
    return {
      url: location.href,
      title: document.title,
      viewport: { innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio: devicePixelRatio },
      bodyText: ((document.body && document.body.innerText) || "").slice(0, 120000),
      bodyHtmlPreview: ((document.body && document.body.innerHTML) || "").slice(0, 120000),
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName.toLowerCase(),
        attrs: attrsOf(document.activeElement),
        text: textOf(document.activeElement)
      } : undefined,
      buttons: query("button, [role='button']", 200),
      links: query("a[href]", 200),
      inputs: query("input, textarea, select", 200),
      headings: query("h1,h2,h3,h4,h5,h6", 100),
      codeCandidates: codeCandidates,
      scripts: Array.from(document.scripts).map(function(script) {
        return { src: script.src, type: script.type, id: script.id, textPreview: script.src ? "" : (script.textContent || "").slice(0, 4000) };
      }),
      stylesheets: Array.from(document.querySelectorAll("link[rel='stylesheet']")).map(function(link) { return link.href; }),
      localStorage: storageOf(localStorage),
      sessionStorage: storageOf(sessionStorage),
      interestingWindowKeys: Object.keys(window).filter(function(key) {
        return /level|session|challenge|ctf|firecrawl|next|vite|react|monaco|editor|__|store|state/i.test(key);
      }).sort().slice(0, 500)
    };
  })()`)) as { bodyText: string };

  await fs.writeFile(path.join(runDir, `${label}-introspection.json`), `${redactText(JSON.stringify(raw, null, 2))}\n`);
  await fs.writeFile(path.join(runDir, `${label}-visible-text.txt`), redactText(raw.bodyText));
}

async function markScrollableContainers(page: Page): Promise<ScrollableDescriptor[]> {
  return page.evaluate(`(() => {
    function describe(element, index) {
      var html = element;
      var rect = html.getBoundingClientRect();
      var scrollHeight = html.scrollHeight;
      var clientHeight = html.clientHeight;
      if (scrollHeight <= clientHeight + 80) return undefined;
      if (rect.width < 180 || rect.height < 120) return undefined;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return undefined;
      var id = "scroll-" + index;
      html.dataset.level3IntrospectScrollId = id;
      return {
        id: id,
        tag: html.tagName.toLowerCase(),
        className: html.className ? String(html.className).slice(0, 500) : "",
        role: html.getAttribute("role"),
        ariaLabel: html.getAttribute("aria-label"),
        textPreview: (html.innerText || html.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrollTop: html.scrollTop,
        scrollHeight: scrollHeight,
        clientHeight: clientHeight
      };
    }
    return Array.from(document.querySelectorAll("body, body *"))
      .map(function(element, index) { return describe(element, index); })
      .filter(function(descriptor) { return Boolean(descriptor); })
      .sort(function(a, b) { return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight); })
      .slice(0, 20);
  })()`);
}

async function captureScrollableScreenshots(
  page: Page,
  runDir: string,
  scrollables: ScrollableDescriptor[]
): Promise<void> {
  const screenshotDir = path.join(runDir, "screenshots", "scrollables");
  await fs.mkdir(screenshotDir, { recursive: true });

  for (const [index, scrollable] of scrollables.entries()) {
    const maxTop = Math.max(0, scrollable.scrollHeight - scrollable.clientHeight);
    const positions = uniqueNumbers([0, Math.round(maxTop / 2), maxTop]);
    for (const [positionIndex, top] of positions.entries()) {
      await page.evaluate(
        function (payload) {
          const element = document.querySelector<HTMLElement>(
            `[data-level3-introspect-scroll-id="${payload.id}"]`
          );
          if (element) element.scrollTop = payload.scrollTop;
        },
        { id: scrollable.id, scrollTop: top }
      );
      await delay(200);
      const base = `${String(index).padStart(2, "0")}-${scrollable.id}-${String(positionIndex).padStart(2, "0")}`;
      await page.screenshot({ path: path.join(screenshotDir, `${base}-viewport.png`), fullPage: false });
      await page
        .locator(`[data-level3-introspect-scroll-id="${scrollable.id}"]`)
        .screenshot({ path: path.join(screenshotDir, `${base}-element.png`) })
        .catch(() => undefined);
    }
  }
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { loadEnvFile } from "./env.js";
import { createLevel3Client } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import {
  describeLevel3TargetMismatch,
  extractLevel3PrestartAssignment,
  extractLevel3UiFeedbackFromText
} from "./level3/ui-feedback.js";
import { extractLevel3UiSessionFromNetworkRecords } from "./level3/ui-session.js";
import { writeJson } from "./level1/api.js";
import { resolveGithubIdentity } from "./identity.js";
import {
  TARGET_URL,
  capturePageState,
  createAuthedContext,
  createRunDir,
  launchBrowser,
  startNetworkRecorder
} from "./recon/capture.js";
import { redactText } from "./recon/redact.js";

loadEnvFile();

async function main(): Promise<void> {
  const github = resolveGithubIdentity();
  const codeFile = process.env.LEVEL3_UI_CODE_FILE ?? process.env.LEVEL3_CODE_FILE;
  const targetTask = process.env.LEVEL3_UI_TASK?.trim();
  const targetLanguage = process.env.LEVEL3_UI_LANGUAGE?.trim();
  const runDir = await createRunDir("level3-ui-feedback");
  const browser = await launchBrowser();
  const client = await createLevel3Client();
  let session = undefined as ReturnType<typeof extractLevel3UiSessionFromNetworkRecords> | undefined;
  let submittedCode = "";
  let preloadedCode: string | undefined;
  let preloadedAssignment: { taskName: string; language: string } | undefined;

  try {
    const context = await createAuthedContext(browser);
    const recorder = startNetworkRecorder(context);
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await capturePageState(page, runDir, "00-dashboard");

    if (!(await pageContains(page, /Compiler Ready|Start Level 3|Paste code|Behavior Bucket/i))) {
      await clickMatchingControl(page, /L3|Build|Level 3/i, "Level 3 dashboard entry");
      await waitForLevel3Prestart(page);
    }

    if (await pageContains(page, /Compiler Ready|Start Level 3|Recommended Diagnostic/i)) {
      await capturePageState(page, runDir, "01-prestart");
      const prestartText = await readBodyText(page);
      preloadedAssignment = extractLevel3PrestartAssignment(prestartText);
      await writeJson(path.join(runDir, "01-prestart-assignment.json"), preloadedAssignment ?? null);
      const prestartMismatch = describeLevel3TargetMismatch(prestartText, targetTask, targetLanguage, preloadedAssignment);
      if (prestartMismatch) {
        await fs.writeFile(path.join(runDir, "01-prestart-visible-text.txt"), redactText(prestartText));
        throw new Error(`${prestartMismatch} Refusing to start timer from UI prestart.`);
      }
      if (!codeFile && process.env.LEVEL3_UI_USE_REGISTERED === "1" && preloadedAssignment) {
        preloadedCode = await loadLevel3CandidateCode(preloadedAssignment.taskName, preloadedAssignment.language, {
          allowUnverified: process.env.LEVEL3_UI_ALLOW_UNVERIFIED_REGISTERED === "1"
        });
        if (!preloadedCode?.trim()) {
          await fs.writeFile(path.join(runDir, "01-prestart-visible-text.txt"), redactText(prestartText));
          throw new Error(
            `No registered candidate for visible ${preloadedAssignment.taskName} [${preloadedAssignment.language}]. Refusing to start timer from UI prestart.`
          );
        }
      }
      await clickMatchingControl(page, /Compiler Ready|Start Level 3|Start/i, "Level 3 start button");
    }

    await waitForRenderedChallenge(page);
    await capturePageState(page, runDir, "02-rendered-before-run");
    await fs.writeFile(path.join(runDir, "02-visible-text.txt"), redactText(await readBodyText(page)));

    session = extractLevel3UiSessionFromNetworkRecords(recorder.records);
    if (!session) {
      await recorder.writeTo(path.join(runDir, "network-before-run.json"));
      session = extractLevel3UiSessionFromNetworkRecords(recorder.records);
    }
    if (!session?.problems?.[0]) {
      throw new Error("Could not extract Level 3 session from UI network records.");
    }

    const challenge = session.problems[0];
    await writeJson(path.join(runDir, "session.json"), session);
    await writeJson(path.join(runDir, "challenge.json"), challenge);
    if (!challengeMatchesTarget(challenge, targetTask, targetLanguage)) {
      submittedCode = challenge.starterCode ?? "";
      throw new Error(
        `UI started ${challenge.taskName} [${challenge.language}], not requested ${targetTask ?? "*"} [${
          targetLanguage ?? "*"
        }].`
      );
    }

    submittedCode = codeFile
      ? await fs.readFile(path.resolve(codeFile), "utf8")
      : preloadedCode && challengeMatchesTarget(challenge, preloadedAssignment?.taskName, preloadedAssignment?.language)
        ? preloadedCode
        : challenge.starterCode ?? "";
    await fs.writeFile(path.join(runDir, `submitted.${sourceExtension(challenge.language)}`), submittedCode);
    const editMethod = await replaceEditorCode(page, submittedCode);
    await writeJson(path.join(runDir, "editor-replace.json"), editMethod);
    await capturePageState(page, runDir, "03-after-code-paste");

    const validationResponsePromise = page
      .waitForResponse((response) => response.url().includes("/api/level-3/validate"), { timeout: 90_000 })
      .catch(() => undefined);
    await clickMatchingControl(page, /^Run$/i, "Run button");
    const validationResponse = await validationResponsePromise;
    const validation = validationResponse ? await validationResponse.json().catch(() => undefined) : undefined;
    await writeJson(path.join(runDir, "validation-from-ui-network.json"), validation ?? null);

    await page.waitForTimeout(1200);
    await capturePageState(page, runDir, "04-after-run-feedback");
    const visibleText = await readBodyText(page);
    await fs.writeFile(path.join(runDir, "04-visible-text.txt"), redactText(visibleText));
    await writeJson(path.join(runDir, "ui-feedback.json"), extractLevel3UiFeedbackFromText(visibleText));
    await recorder.writeTo(path.join(runDir, "network.json"));
    await context.close();
  } finally {
    await browser.close();
    if (session?.problems?.[0] && process.env.LEVEL3_UI_SKIP_FINISH !== "1") {
      const finish = await client.finishSession(session, submittedCode, github, 120_000).catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error)
      }));
      await writeJson(path.join(runDir, "finish-result.json"), finish);
    }
  }

  console.log(`Level 3 UI feedback artifacts: ${runDir}`);
}

async function replaceEditorCode(page: Page, code: string): Promise<{ method: string; firstLineVisible: boolean }> {
  const editor = page.locator(".cm-content[contenteditable='true'], [contenteditable='true'], textarea").first();
  await editor.click({ timeout: 10_000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(code);
  await page.waitForTimeout(300);

  const firstLine = code.split(/\r?\n/, 1)[0]?.trim();
  const firstLineVisible = firstLine
    ? await page
        .locator(".cm-content, textarea, [contenteditable='true']")
        .filter({ hasText: firstLine })
        .first()
        .isVisible()
        .catch(() => false)
    : true;

  return { method: "keyboard-select-all-insert", firstLineVisible };
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
  return pattern.test(await readBodyText(page).catch(() => ""));
}

async function readBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? "");
}

async function waitForLevel3Prestart(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      var body = (document.body && document.body.innerText) || "";
      if (/Loading your next Level 3 challenge details/i.test(body)) return false;
      var button = Array.from(document.querySelectorAll("button")).find(function(element) {
        return /Compiler Ready|Start Level 3|Start/i.test(element.innerText || element.textContent || "");
      });
      return body.length > 200 && /Compiler Ready|Start Level 3|Recommended Diagnostic|Your next Level 3 challenge|Assigned/i.test(body) && Boolean(button) && !button.disabled;
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

function challengeMatchesTarget(
  challenge: { taskName: string; language: string },
  taskName: string | undefined,
  language: string | undefined
): boolean {
  return (!taskName || challenge.taskName === taskName) && (!language || challenge.language === language);
}

function sourceExtension(language: string): string {
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  if (language === "Rust") return "rs";
  return "txt";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { solveKnownProblem } from "./level1/solutions.js";
import type { CheetProblem } from "./level1/types.js";

export interface SafariBridgeOptions {
  github: string;
  submissionLimit?: number;
}

interface CliOptions extends SafariBridgeOptions {
  outputPath: string;
}

export async function buildSafariLevel1Bridge(options: SafariBridgeOptions): Promise<string> {
  const github = options.github.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(github)) {
    throw new Error(`Invalid GitHub identity: ${JSON.stringify(options.github)}`);
  }

  const submissionLimit = options.submissionLimit ?? 25;
  if (!Number.isInteger(submissionLimit) || submissionLimit < 1 || submissionLimit > 25) {
    throw new Error(`submissionLimit must be an integer from 1 through 25; received ${submissionLimit}`);
  }

  const catalog = await buildBrowserSolutionCatalog();
  const config = { github, submissionLimit };

  return `(() => {
  const CONFIG = ${JSON.stringify(config)};
  const SOLUTIONS = ${JSON.stringify(catalog)};
  const STORAGE_KEY = "cheetcode.safariBridge.lastResult";
  const SNAPSHOT_KEY = "cheetcode.v1.sessionSnapshot";
  const existing = window.__cheetcodeSafariBridge;
  if (existing && existing.status === "armed") {
    clearInterval(existing.pollTimer);
  }

  const state = {
    status: "armed",
    armedAt: Date.now(),
    catalogSize: Object.keys(SOLUTIONS).length,
    pollTimer: undefined,
    sessionId: undefined,
    validation: undefined,
    result: undefined,
    error: undefined
  };
  window.__cheetcodeSafariBridge = state;

  const postJson = async (urlPath, body, fingerprintId) => {
    const response = await fetch(urlPath, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-client-fingerprint": fingerprintId
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(urlPath + " failed with " + response.status + ": " + text.slice(0, 1000));
    return JSON.parse(text);
  };

  const run = async (session) => {
    state.status = "running";
    state.sessionId = session.sessionId;
    const fingerprintId = localStorage.getItem("ctf:fp:visitor-id");
    if (!fingerprintId) throw new Error("Safari has no ctf:fp:visitor-id in localStorage");

    const submissions = session.problems.slice(0, CONFIG.submissionLimit).map((problem) => {
      const functionName = /function\\s+([A-Za-z_$][\\w$]*)/.exec(problem.signature)?.[1];
      const code = functionName ? SOLUTIONS[functionName] : undefined;
      if (!functionName || !code) {
        throw new Error("No catalog solution for " + problem.title + " | " + problem.signature);
      }
      return { problemId: problem.id, code };
    });

    const validation = await Promise.all(submissions.map((submission) =>
      postJson("/api/level-1/validate", {
        sessionId: session.sessionId,
        problemId: submission.problemId,
        code: submission.code
      }, fingerprintId)
    ));
    state.validation = validation;
    const rejected = validation.filter((item) => item.passed !== true);
    if (rejected.length > 0) throw new Error("Server rejected " + rejected.length + " submission(s)");

    const result = await postJson("/api/level-1/finish", {
      sessionId: session.sessionId,
      github: CONFIG.github,
      timeElapsed: Math.max(0, Date.now() - session.startedAt),
      submissions
    }, fingerprintId);
    state.status = "finished";
    state.result = result;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      capturedAt: new Date().toISOString(),
      github: CONFIG.github,
      submissionCount: submissions.length,
      validation,
      result
    }));
    console.log("[safari-bridge] finished", result);
    return result;
  };

  state.pollTimer = setInterval(() => {
    if (state.status !== "armed") {
      clearInterval(state.pollTimer);
      return;
    }
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session.level !== 1 || !session.sessionId || !Array.isArray(session.problems)) return;
      if (typeof session.expiresAt === "number" && session.expiresAt <= Date.now()) return;
      clearInterval(state.pollTimer);
      void run(session).catch((error) => {
        state.status = "failed";
        state.error = error instanceof Error ? error.message : String(error);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          capturedAt: new Date().toISOString(),
          github: CONFIG.github,
          error: state.error
        }));
        console.error("[safari-bridge] failed", error);
      });
    } catch (error) {
      state.status = "failed";
      state.error = error instanceof Error ? error.message : String(error);
      clearInterval(state.pollTimer);
      console.error("[safari-bridge] failed", error);
    }
  }, 20);

  console.log("[safari-bridge] armed", { github: CONFIG.github, catalogSize: state.catalogSize, submissionLimit: CONFIG.submissionLimit });
  return { armed: true, github: CONFIG.github, catalogSize: state.catalogSize, submissionLimit: CONFIG.submissionLimit };
})()`;
}

async function buildBrowserSolutionCatalog(): Promise<Record<string, string>> {
  const sourcePath = fileURLToPath(new URL("./level1/solutions.ts", import.meta.url));
  const source = await fs.readFile(sourcePath, "utf8");
  const functionNames = Array.from(source.matchAll(/^  ([A-Za-z_$][\w$]*): \(\) =>/gm), (match) => match[1]!);
  if (functionNames.length === 0) throw new Error(`No Level 1 solver factories found in ${sourcePath}`);

  return Object.fromEntries(
    functionNames.map((functionName) => {
      const problem: CheetProblem = {
        id: `catalog-${functionName}`,
        title: functionName,
        tier: "catalog",
        description: "",
        signature: `function ${functionName}()`,
        starterCode: `function ${functionName}() {}`,
        testCases: []
      };
      const solved = solveKnownProblem(problem);
      if (!solved.known) throw new Error(`Catalog factory could not resolve ${functionName}`);
      return [functionName, solved.code];
    })
  );
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const script = await buildSafariLevel1Bridge(options);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${script}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ outputPath: options.outputPath, bytes: Buffer.byteLength(script), github: options.github, submissionLimit: options.submissionLimit ?? 25 }));
}

function parseCliOptions(args: string[]): CliOptions {
  const github = valueAfter(args, "--github");
  if (!github) throw new Error("Usage: tsx src/safari-level1-bridge.ts --github <account> --output <file> [--limit 1..25]");
  const outputPath = path.resolve(valueAfter(args, "--output") ?? "recon-output/safari-level1-bridge.js");
  const limitRaw = valueAfter(args, "--limit");
  return {
    github,
    outputPath,
    submissionLimit: limitRaw === undefined ? 25 : Number(limitRaw)
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

import vm from "node:vm";
import { promises as fs } from "node:fs";
import path from "node:path";

import { solveKnownProblem } from "./level1/solutions.js";
import type { CheetProblem } from "./level1/types.js";

interface ApiRecord {
  url: string;
  status: number;
  responseBody: string;
}

interface SessionResponse {
  problems: CheetProblem[];
}

interface CheckResult {
  title: string;
  functionName: string;
  known: boolean;
  examplesPassed: boolean;
  error?: string;
}

const logPath = process.env.LEVEL1_SESSION_LOG;

if (!logPath) {
  console.error("Set LEVEL1_SESSION_LOG to a trusted, authorized local API log. This command executes saved JavaScript examples; it is not a sandbox.");
  process.exitCode = 1;
} else {
  checkBatch(path.resolve(logPath))
    .then((results) => {
      const failed = results.filter((result) => !result.known || !result.examplesPassed);
      console.log(JSON.stringify({ logPath: path.resolve(logPath), total: results.length, failed: failed.length, results }, null, 2));
      if (failed.length > 0) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
}

export async function checkBatch(filePath: string): Promise<CheckResult[]> {
  const records = JSON.parse(await fs.readFile(filePath, "utf8")) as ApiRecord[];
  const sessionRecord = records.find((record) => record.url.endsWith("/api/session") && record.status === 200);
  if (!sessionRecord) throw new Error("No successful /api/session response in the API log");

  const session = JSON.parse(sessionRecord.responseBody) as SessionResponse;
  return session.problems.map((problem) => checkProblem(problem));
}

function checkProblem(problem: CheetProblem): CheckResult {
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1] ?? "unknown";
  const solved = solveKnownProblem(problem);
  if (!solved.known) return { title: problem.title, functionName, known: false, examplesPassed: false };

  try {
    const context = vm.createContext({});
    vm.runInContext(`${solved.code}; globalThis.__fn = ${functionName};`, context, { timeout: 1000 });
    const fn = context.__fn as (...args: unknown[]) => unknown;
    for (const testCase of problem.testCases) {
      const actual = fn(...testCase.args);
      if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
        return {
          title: problem.title,
          functionName,
          known: true,
          examplesPassed: false,
          error: `Expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`
        };
      }
    }
    return { title: problem.title, functionName, known: true, examplesPassed: true };
  } catch (error) {
    return {
      title: problem.title,
      functionName,
      known: true,
      examplesPassed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

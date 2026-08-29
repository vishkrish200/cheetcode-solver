/**
 * Run a no-network rehearsal against committed synthetic fixtures or an
 * explicitly selected saved run.
 *
 * This file deliberately does not import the HTTP clients, read
 * recon-output/storage-state.json, or call fetch. It checks the local solver
 * and compiler paths only; it cannot measure server-side SPEED DEMON timing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem, LevelSession as Level1Session } from "../src/level1/types.js";
import { buildCachedAnswersForLevel2Session, loadLevel2CatalogFromChunks } from "../src/level2/catalog.js";
import type { Level2Session } from "../src/level2/types.js";
import { compileLevel3Source } from "../src/level3/local-compile.js";
import { findVerifiedLevel3Candidate, loadLevel3CandidateCode } from "../src/level3/candidates.js";
import type { Level3Session } from "../src/level3/types.js";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(WORKSPACE_ROOT, "recon-output");
const DEFAULT_RUN_DIR = path.join(WORKSPACE_ROOT, "fixtures", "rehearsal", "run");
const DEFAULT_CATALOG_DIR = path.join(WORKSPACE_ROOT, "fixtures", "rehearsal", "catalog");

interface CliOptions {
  runDir?: string;
  level1?: string;
  level2?: string;
  level3?: string;
  level2Catalog?: string;
  output?: string;
}

interface RehearsalReport {
  mode: "offline-local-only";
  networkCalls: false;
  cookiesRead: false;
  sourceRunDir: string;
  outputDir: string;
  levels: {
    level1: Level1Report;
    level2: Level2Report;
    level3: Level3Report;
  };
}

interface Level1Report {
  problems: number;
  knownSolutions: number;
  samplePassing: number;
  readyForLocalSubmissionShape: boolean;
}

interface Level2Report {
  problems: number;
  catalogEntries: number;
  catalogMatches: number;
  catalogMisses: number;
  readyForLocalSubmissionShape: boolean;
}

interface Level3Report {
  taskName?: string;
  language?: string;
  verifiedCandidateFound: boolean;
  candidateCodeLoaded: boolean;
  compiled: boolean;
  compilerErrorPresent: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === "help") {
    printHelp();
    return;
  }

  const sourceRunDir = path.resolve(options.runDir ?? (await findLatestCompleteRunDir()) ?? DEFAULT_RUN_DIR);
  const level1Path = path.resolve(options.level1 ?? path.join(sourceRunDir, "level1-session.json"));
  const level2Path = path.resolve(options.level2 ?? path.join(sourceRunDir, "level2-session.json"));
  const level3Path = path.resolve(options.level3 ?? path.join(sourceRunDir, "level3-session.json"));
  const catalogDir = path.resolve(options.level2Catalog ?? DEFAULT_CATALOG_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.resolve(options.output ?? path.join(OUTPUT_ROOT, `${stamp}-local-rehearsal`));
  await fs.mkdir(outputDir, { recursive: true });

  const level1 = await rehearseLevel1(level1Path);
  const level2 = await rehearseLevel2(level2Path, catalogDir);
  const level3 = await rehearseLevel3(level3Path, outputDir);

  const report: RehearsalReport = {
    mode: "offline-local-only",
    networkCalls: false,
    cookiesRead: false,
    sourceRunDir,
    outputDir,
    levels: { level1, level2, level3 }
  };
  await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Local rehearsal complete: ${outputDir}`);
  console.log(
    `L1: ${level1.knownSolutions}/${level1.problems} known, ${level1.samplePassing}/${level1.problems} sample checks passed`
  );
  console.log(
    `L2: ${level2.catalogMatches}/${level2.problems} catalog matches (${level2.catalogEntries} catalog entries)`
  );
  console.log(
    `L3: ${level3.taskName ?? "unknown task"} [${level3.language ?? "unknown language"}], compiled=${level3.compiled}`
  );
  console.log("No cookies were read and no network requests were made.");
}

async function rehearseLevel1(sessionPath: string): Promise<Level1Report> {
  const session = await readJson<Level1Session>(sessionPath);
  const problems = Array.isArray(session.problems) ? session.problems : [];
  const solved = problems.map((problem) => solveKnownProblem(problem));
  const samplePassing = solved.reduce((count, candidate, index) => {
    const problem = problems[index];
    return count + (candidate.known && problem && passesJavaScriptSamples(candidate.code, problem) ? 1 : 0);
  }, 0);

  return {
    problems: problems.length,
    knownSolutions: solved.filter((candidate) => candidate.known).length,
    samplePassing,
    readyForLocalSubmissionShape: problems.length > 0 && solved.length === problems.length
  };
}

async function rehearseLevel2(sessionPath: string, catalogDir: string): Promise<Level2Report> {
  const session = await readJson<Level2Session>(sessionPath);
  const problems = Array.isArray(session.problems) ? session.problems : [];
  const catalog = await loadLevel2CatalogFromChunks(catalogDir);
  const { answers, misses } = buildCachedAnswersForLevel2Session(catalog, problems);

  return {
    problems: problems.length,
    catalogEntries: catalog.length,
    catalogMatches: Object.keys(answers).length,
    catalogMisses: misses.length,
    readyForLocalSubmissionShape: problems.length > 0 && misses.length === 0
  };
}

async function rehearseLevel3(sessionPath: string, outputDir: string): Promise<Level3Report> {
  const session = await readJson<Level3Session>(sessionPath);
  const challenge = session.problems?.[0];
  if (!challenge) {
    return {
      verifiedCandidateFound: false,
      candidateCodeLoaded: false,
      compiled: false,
      compilerErrorPresent: false
    };
  }

  const candidate = findVerifiedLevel3Candidate(challenge.taskName, challenge.language);
  const code = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
  if (!code) {
    return {
      taskName: challenge.taskName,
      language: challenge.language,
      verifiedCandidateFound: Boolean(candidate),
      candidateCodeLoaded: false,
      compiled: false,
      compilerErrorPresent: false
    };
  }

  const compile = await compileLevel3Source(outputDir, "level3", challenge.language, code);
  return {
    taskName: challenge.taskName,
    language: challenge.language,
    verifiedCandidateFound: Boolean(candidate),
    candidateCodeLoaded: true,
    compiled: compile.ok,
    compilerErrorPresent: Boolean(compile.error)
  };
}

function passesJavaScriptSamples(code: string, problem: CheetProblem): boolean {
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!functionName) return false;

  try {
    const context = vm.createContext({});
    vm.runInContext(`${code}; globalThis.__rehearsalFn = ${functionName};`, context, { timeout: 1_000 });
    const fn = context.__rehearsalFn as (...args: unknown[]) => unknown;
    return problem.testCases.every((testCase) => JSON.stringify(fn(...testCase.args)) === JSON.stringify(testCase.expected));
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function findLatestCompleteRunDir(): Promise<string | undefined> {
  if (!(await fileExists(OUTPUT_ROOT))) return undefined;
  const entries = await fs.readdir(OUTPUT_ROOT, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(OUTPUT_ROOT, entry.name);
    const required = ["level1-session.json", "level2-session.json", "level3-session.json"];
    if ((await Promise.all(required.map(async (name) => fileExists(path.join(candidate, name))))).every(Boolean)) {
      candidates.push(candidate);
    }
  }
  return candidates.sort().at(-1);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): CliOptions | "help" {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === "--help" || arg === "-h") return "help";
    const next = argv[index + 1];
    if (arg === "--run-dir" && next) options.runDir = next;
    else if (arg === "--level1" && next) options.level1 = next;
    else if (arg === "--level2" && next) options.level2 = next;
    else if (arg === "--level3" && next) options.level3 = next;
    else if (arg === "--level2-catalog" && next) options.level2Catalog = next;
    else if (arg === "--output" && next) options.output = next;
    else if (arg.startsWith("--")) throw new Error(`Unknown or incomplete option: ${arg}`);
    else throw new Error(`Unexpected argument: ${arg}`);
    index += 1;
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage:
  npm run local:rehearsal                         Use committed synthetic fixtures.
  npm run local:rehearsal -- --run-dir recon-output/<saved-run>
  npm run local:rehearsal -- --level1 <file> --level2 <file> --level3 <file> --level2-catalog <dir>

This is strictly offline. It reads synthetic or explicitly selected session artifacts,
solves Level 1 locally, matches Level 2 against a catalog, and compiles a verified Level 3 candidate.
It never reads Safari/GitHub cookies, calls fetch, starts a CTF session, validates,
finishes, or measures server-side SPEED DEMON timing.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

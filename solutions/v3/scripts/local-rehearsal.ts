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
import { fileURLToPath, pathToFileURL } from "node:url";
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
export const DEFAULT_RUN_DIR = path.join(WORKSPACE_ROOT, "fixtures", "rehearsal", "run");
export const DEFAULT_CATALOG_DIR = path.join(WORKSPACE_ROOT, "fixtures", "rehearsal", "catalog");

export interface CliOptions {
  runDir?: string;
  level1?: string;
  level2?: string;
  level3?: string;
  level2Catalog?: string;
  output?: string;
}

export interface RehearsalReport {
  success: boolean;
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
  problems: number;
  taskName?: string;
  language?: string;
  verifiedCandidateFound: boolean;
  candidateCodeLoaded: boolean;
  compiled: boolean;
  compilerErrorPresent: boolean;
  readyForLocalSubmissionShape: boolean;
}

export async function runLocalRehearsal(options: CliOptions = {}): Promise<RehearsalReport> {
  // Never discover saved runs implicitly: even a populated recon-output directory
  // must not change the public, synthetic onboarding experience.
  const sourceRunDir = path.resolve(options.runDir ?? DEFAULT_RUN_DIR);
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
    success: level1.readyForLocalSubmissionShape && level2.readyForLocalSubmissionShape && level3.readyForLocalSubmissionShape,
    mode: "offline-local-only",
    networkCalls: false,
    cookiesRead: false,
    sourceRunDir,
    outputDir,
    levels: { level1, level2, level3 }
  };
  await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function rehearseLevel1(sessionPath: string): Promise<Level1Report> {
  const session = await readJson<Level1Session>(sessionPath);
  const problems = readProblems(session, "Level 1");
  const solved = problems.map((problem) => solveKnownProblem(problem));
  const samplePassing = solved.reduce((count, candidate, index) => {
    const problem = problems[index];
    return count + (candidate.known && problem && passesJavaScriptSamples(candidate.code, problem) ? 1 : 0);
  }, 0);

  return {
    problems: problems.length,
    knownSolutions: solved.filter((candidate) => candidate.known).length,
    samplePassing,
    readyForLocalSubmissionShape: problems.length > 0 && solved.every((candidate) => candidate.known) && samplePassing === problems.length
  };
}

async function rehearseLevel2(sessionPath: string, catalogDir: string): Promise<Level2Report> {
  const session = await readJson<Level2Session>(sessionPath);
  const problems = readProblems(session, "Level 2");
  const catalog = await loadLevel2CatalogFromChunks(catalogDir);
  const { answers, misses } = buildCachedAnswersForLevel2Session(catalog, problems);

  return {
    problems: problems.length,
    catalogEntries: catalog.length,
    catalogMatches: Object.keys(answers).length,
    catalogMisses: misses.length,
    readyForLocalSubmissionShape: problems.length > 0 && catalog.length > 0 && misses.length === 0 && Object.keys(answers).length === problems.length
  };
}

async function rehearseLevel3(sessionPath: string, outputDir: string): Promise<Level3Report> {
  const session = await readJson<Level3Session>(sessionPath);
  const problems = readProblems(session, "Level 3");
  const challenge = problems[0];
  // The Level 3 runner compiles one challenge containing multiple checks, not
  // multiple independent challenges. Do not silently validate only the first.
  if (problems.length !== 1 || !challenge) {
    return {
      problems: problems.length,
      verifiedCandidateFound: false,
      candidateCodeLoaded: false,
      compiled: false,
      compilerErrorPresent: false,
      readyForLocalSubmissionShape: false
    };
  }

  const candidate = findVerifiedLevel3Candidate(challenge.taskName, challenge.language);
  const code = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
  if (!candidate || !code?.trim()) {
    return {
      problems: problems.length,
      taskName: challenge.taskName,
      language: challenge.language,
      verifiedCandidateFound: Boolean(candidate),
      candidateCodeLoaded: Boolean(code?.trim()),
      compiled: false,
      compilerErrorPresent: false,
      readyForLocalSubmissionShape: false
    };
  }

  // The compiler helper treats unsupported languages as a no-op. A rehearsal
  // must not label that as a successful compilation.
  const compile = ["C", "C++", "Rust"].includes(challenge.language)
    ? await compileLevel3Source(outputDir, "level3", challenge.language, code)
    : { ok: false, error: `Unsupported compiler language: ${challenge.language}` };
  return {
    problems: problems.length,
    taskName: challenge.taskName,
    language: challenge.language,
    verifiedCandidateFound: Boolean(candidate),
    candidateCodeLoaded: true,
    compiled: compile.ok,
    compilerErrorPresent: Boolean(compile.error),
    readyForLocalSubmissionShape: compile.ok && !compile.error
  };
}

export function passesJavaScriptSamples(code: string, problem: CheetProblem, timeoutMs = 1_000): boolean {
  if (!Array.isArray(problem.testCases) || problem.testCases.length === 0) return false;
  if (problem.testCases.some((testCase) => !testCase || !Array.isArray(testCase.args) || !("expected" in testCase))) return false;
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!functionName) return false;

  try {
    // Initialization, every invocation, result serialization and queued
    // microtasks all stay inside the timeout. No guest function crosses into
    // the host process. This is a hang guard, not a sandbox for hostile code.
    return vm.runInNewContext(
      `${code};\n${JSON.stringify(problem.testCases)}.every((sample) =>
        JSON.stringify(${functionName}(...sample.args)) === JSON.stringify(sample.expected));`,
      Object.create(null),
      { timeout: timeoutMs, microtaskMode: "afterEvaluate", contextCodeGeneration: { strings: false, wasm: false } }
    ) === true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function readProblems<T>(session: { problems: T[] }, level: string): T[] {
  if (!session || typeof session !== "object" || !Array.isArray(session.problems)) {
    throw new Error(`${level} session must contain a problems array.`);
  }
  return session.problems;
}

export function parseRehearsalArgs(argv: string[]): CliOptions | "help" {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return "help";
  const options: CliOptions = {};
  const names: Record<string, keyof CliOptions> = {
    "--run-dir": "runDir", "--level1": "level1", "--level2": "level2", "--level3": "level3",
    "--level2-catalog": "level2Catalog", "--output": "output"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    const key = Object.hasOwn(names, arg) ? names[arg] : undefined;
    if (!key) throw new Error(`Unknown option or unexpected argument: ${arg}`);
    const next = argv[index + 1];
    if (!next?.trim() || next.startsWith("-")) throw new Error(`Missing path for ${arg}`);
    if (options[key] !== undefined) throw new Error(`Duplicate option: ${arg}`);
    options[key] = next;
    index += 1;
  }
  return options;
}

const HELP = `Usage:
  npm run local:rehearsal                         Use committed synthetic fixtures.
  npm run local:rehearsal -- --run-dir recon-output/<saved-run>
  npm run local:rehearsal -- --level1 <file> --level2 <file> --level3 <file> --level2-catalog <dir>

This is strictly offline. It reads synthetic or explicitly selected session artifacts,
solves Level 1 locally, matches Level 2 against a catalog, and compiles a verified Level 3 candidate.
It never reads Safari/GitHub cookies, calls fetch, starts a CTF session, validates,
finishes, or measures server-side SPEED DEMON timing.
Exit status is 0 only if all local checks pass; failures and invalid inputs return 1.
`;

export async function runRehearsalCli(argv: string[], io: Pick<Console, "log" | "error"> = console): Promise<number> {
  try {
    const options = parseRehearsalArgs(argv);
    if (options === "help") {
      io.log(HELP);
      return 0;
    }
    const report = await runLocalRehearsal(options);
    const { level1, level2, level3 } = report.levels;
    io.log(`Local rehearsal ${report.success ? "passed" : "failed"}: ${report.outputDir}`);
    io.log(`L1: ${level1.knownSolutions}/${level1.problems} known, ${level1.samplePassing}/${level1.problems} sample checks passed`);
    io.log(`L2: ${level2.catalogMatches}/${level2.problems} catalog matches (${level2.catalogEntries} catalog entries)`);
    io.log(`L3: ${level3.taskName ?? "unknown task"} [${level3.language ?? "unknown language"}], compiled=${level3.compiled}`);
    io.log("No cookies were read and no network requests were made.");
    return report.success ? 0 : 1;
  } catch (error: unknown) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runRehearsalCli(process.argv.slice(2));
}

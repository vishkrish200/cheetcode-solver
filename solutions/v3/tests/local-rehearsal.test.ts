import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CATALOG_DIR,
  DEFAULT_RUN_DIR,
  parseRehearsalArgs,
  passesJavaScriptSamples,
  runLocalRehearsal,
  runRehearsalCli
} from "../scripts/local-rehearsal.js";
import * as candidates from "../src/level3/candidates.js";
import { compileLevel3Source } from "../src/level3/local-compile.js";
import type { CheetProblem, LevelSession } from "../src/level1/types.js";

vi.mock("../src/level3/local-compile.js", () => ({ compileLevel3Source: vi.fn() }));

let temporaryDir: string;
const io = { log: vi.fn(), error: vi.fn() };

beforeEach(async () => {
  temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "cheetcode-rehearsal-test-"));
  vi.mocked(compileLevel3Source).mockReset().mockResolvedValue({ ok: true });
  io.log.mockClear();
  io.error.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Rehearsal must never fetch."); }));
});

afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await fs.rm(temporaryDir, { recursive: true, force: true });
});

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DEFAULT_RUN_DIR, name), "utf8")) as T;
}

async function writeFixture(name: string, data: unknown): Promise<string> {
  const file = path.join(temporaryDir, name);
  await fs.writeFile(file, JSON.stringify(data));
  return file;
}

describe("rehearsal arguments", () => {
  it("uses explicit fixture overrides and supports standalone help", () => {
    expect(parseRehearsalArgs([])).toEqual({});
    expect(parseRehearsalArgs(["--help"])).toBe("help");
    expect(parseRehearsalArgs(["-h"])).toBe("help");
    expect(parseRehearsalArgs([
      "--run-dir", "run", "--level1", "one.json", "--level2", "two.json", "--level3", "three.json",
      "--level2-catalog", "catalog", "--output", "results"
    ])).toEqual({ runDir: "run", level1: "one.json", level2: "two.json", level3: "three.json", level2Catalog: "catalog", output: "results" });
  });

  it.each([
    ["--unknown"], ["extra"], ["toString", "value"], ["__proto__", "value"], ["--level1"], ["--output", "--level1"], ["--output", ""],
    ["--output", "a", "--output", "b"], ["--help", "ignored"], ["--level1", "--help"]
  ])("rejects malformed arguments: %j", (...argv) => {
    expect(() => parseRehearsalArgs(argv)).toThrow();
  });

  it("help exits without reading files or invoking a compiler", async () => {
    const read = vi.spyOn(fs, "readFile");
    expect(await runRehearsalCli(["--help"], io)).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(compileLevel3Source).not.toHaveBeenCalled();
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("strictly offline"));
  });
});

describe("synthetic offline rehearsal", () => {
  it("defaults to committed fixtures without discovering saved runs or reading cookies", async () => {
    const read = vi.spyOn(fs, "readFile");
    const access = vi.spyOn(fs, "access");
    const directories = vi.spyOn(fs, "readdir");
    const report = await runLocalRehearsal({ output: temporaryDir });
    expect(report).toMatchObject({ success: true, sourceRunDir: DEFAULT_RUN_DIR, networkCalls: false, cookiesRead: false });
    expect(access).not.toHaveBeenCalled();
    expect(directories.mock.calls.map(([directory]) => directory)).toEqual([DEFAULT_CATALOG_DIR]);
    expect(read.mock.calls.every(([file]) => !String(file).includes("storage-state") && !String(file).includes("recon-output"))).toBe(true);
    expect(report.levels.level1).toMatchObject({ problems: 1, knownSolutions: 1, samplePassing: 1, readyForLocalSubmissionShape: true });
    expect(report.levels.level2).toMatchObject({ problems: 1, catalogMatches: 1, readyForLocalSubmissionShape: true });
    expect(report.levels.level3).toMatchObject({ problems: 1, verifiedCandidateFound: true, candidateCodeLoaded: true, compiled: true });
    expect(JSON.parse(await fs.readFile(path.join(temporaryDir, "report.json"), "utf8"))).toEqual(report);
  });

  it("honors a saved-run directory and individual file/catalog overrides", async () => {
    await fs.cp(DEFAULT_RUN_DIR, temporaryDir, { recursive: true });
    const catalog = path.join(temporaryDir, "catalog");
    await fs.cp(DEFAULT_CATALOG_DIR, catalog, { recursive: true });
    const customLevel1 = await fixture<LevelSession>("level1-session.json");
    customLevel1.problems[0]!.testCases[0]!.expected = "deliberately wrong";
    const level1 = await writeFixture("override.json", customLevel1);
    const report = await runLocalRehearsal({ runDir: temporaryDir, level1, level2Catalog: catalog, output: path.join(temporaryDir, "out") });
    expect(report.sourceRunDir).toBe(temporaryDir);
    expect(report.success).toBe(false);
    expect(report.levels.level1.samplePassing).toBe(0);
    expect(report.levels.level2.catalogMatches).toBe(1);
  });

  it.each(["level1", "level2", "level3"] as const)("does not accept an empty %s session", async (level) => {
    const file = await writeFixture("empty.json", { problems: [] });
    const report = await runLocalRehearsal({ [level]: file, output: temporaryDir });
    expect(report.success).toBe(false);
    expect(report.levels[level].readyForLocalSubmissionShape).toBe(false);
  });

  it.each([null, {}, { problems: "invalid" }])("rejects malformed session structure: %j", async (value) => {
    const level1 = await writeFixture("invalid.json", value);
    expect(await runRehearsalCli(["--level1", level1, "--output", temporaryDir], io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("problems array"));
  });

  it("requires known solutions and nonempty passing Level 1 samples", async () => {
    const session = await fixture<LevelSession>("level1-session.json");
    session.problems[0]!.signature = "function noRegisteredSolver()";
    session.problems[0]!.starterCode = "function noRegisteredSolver() { return 'kick'; }";
    const level1 = await writeFixture("unknown.json", session);
    const unknown = await runLocalRehearsal({ level1, output: temporaryDir });
    expect(unknown.success).toBe(false);
    expect(unknown.levels.level1.knownSolutions).toBe(0);
    session.problems[0]!.signature = "function getDrumForBeat(beatNumber)";
    session.problems[0]!.testCases = [];
    await writeFixture("unknown.json", session);
    const noSamples = await runLocalRehearsal({ level1, output: temporaryDir });
    expect(noSamples.success).toBe(false);
    expect(noSamples.levels.level1.samplePassing).toBe(0);
  });

  it("requires complete, unambiguous Level 2 catalog coverage", async () => {
    const level2 = await writeFixture("missing-answer.json", { problems: [{ id: "missing", question: "Not in the catalog" }] });
    const missing = await runLocalRehearsal({ level2, output: temporaryDir });
    expect(missing.success).toBe(false);
    expect(missing.levels.level2.catalogMisses).toBe(1);
    const session = await fixture<{ problems: unknown[] }>("level2-session.json");
    session.problems.push(session.problems[0]);
    await writeFixture("missing-answer.json", session);
    expect((await runLocalRehearsal({ level2, output: temporaryDir })).success).toBe(false);
  });

  it("rejects an empty catalog instead of treating it as coverage", async () => {
    const catalog = path.join(temporaryDir, "empty-catalog");
    await fs.mkdir(catalog);
    expect(await runRehearsalCli(["--level2-catalog", catalog, "--output", temporaryDir], io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("No Level 2 catalog found"));
  });

  it("does not ignore extra Level 3 challenges", async () => {
    const session = await fixture<{ problems: unknown[] }>("level3-session.json");
    session.problems.push(session.problems[0]);
    const level3 = await writeFixture("extra-challenge.json", session);
    const report = await runLocalRehearsal({ level3, output: temporaryDir });
    expect(report.success).toBe(false);
    expect(compileLevel3Source).not.toHaveBeenCalled();
  });

  it("requires a verified candidate even if candidate source is available", async () => {
    vi.spyOn(candidates, "findVerifiedLevel3Candidate").mockReturnValue(undefined);
    const report = await runLocalRehearsal({ output: temporaryDir });
    expect(report.success).toBe(false);
    expect(report.levels.level3.verifiedCandidateFound).toBe(false);
    expect(compileLevel3Source).not.toHaveBeenCalled();
  });

  it.each([undefined, "", " \n"])("requires nonempty candidate source: %j", async (code) => {
    vi.spyOn(candidates, "loadLevel3CandidateCode").mockResolvedValue(code);
    const report = await runLocalRehearsal({ output: temporaryDir });
    expect(report.success).toBe(false);
    expect(report.levels.level3.candidateCodeLoaded).toBe(false);
    expect(compileLevel3Source).not.toHaveBeenCalled();
  });

  it("exits nonzero for compiler failures and zero only for a complete local pass", async () => {
    vi.mocked(compileLevel3Source).mockResolvedValue({ ok: false, error: "compiler unavailable" });
    expect(await runRehearsalCli(["--output", temporaryDir], io)).toBe(1);
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("Local rehearsal failed"));
    vi.mocked(compileLevel3Source).mockResolvedValue({ ok: true });
    expect(await runRehearsalCli(["--output", temporaryDir], io)).toBe(0);
  });

  it("does not treat unsupported compiler languages as a successful no-op", async () => {
    const session = await fixture<{ problems: Array<{ language: string }> }>("level3-session.json");
    session.problems[0]!.language = "JavaScript";
    const level3 = await writeFixture("unsupported.json", session);
    vi.spyOn(candidates, "findVerifiedLevel3Candidate").mockReturnValue({ taskName: "Synthetic", language: "JavaScript", source: "manual", sourcePath: "unused" });
    vi.spyOn(candidates, "loadLevel3CandidateCode").mockResolvedValue("function solve() {}");
    const report = await runLocalRehearsal({ level3, output: temporaryDir });
    expect(report.success).toBe(false);
    expect(report.levels.level3.compilerErrorPresent).toBe(true);
    expect(compileLevel3Source).not.toHaveBeenCalled();
  });

  it("reports missing files and malformed CLI arguments as failures", async () => {
    expect(await runRehearsalCli(["--level1", path.join(temporaryDir, "missing.json"), "--output", temporaryDir], io)).toBe(1);
    expect(await runRehearsalCli(["--run-dir"], io)).toBe(1);
  });
});

describe("bounded Level 1 sample evaluation", () => {
  const problem: CheetProblem = {
    id: "test", title: "Test", tier: "easy", description: "Synthetic", signature: "function solve(n)",
    starterCode: "", testCases: [{ args: [1], expected: 2 }]
  };

  it("checks all samples and rejects missing samples", () => {
    expect(passesJavaScriptSamples("function solve(n) { return n + 1; }", problem)).toBe(true);
    expect(passesJavaScriptSamples("function solve() { return 2; }", { ...problem, testCases: [...problem.testCases, { args: [2], expected: 3 }] })).toBe(false);
    expect(passesJavaScriptSamples("function solve() {}", { ...problem, testCases: [] })).toBe(false);
  });

  it.each([
    "while (true) {} function solve() {}",
    "function solve() { while (true) {} }",
    "function solve() { return { toJSON() { while (true) {} } }; }",
    "function solve() { Promise.resolve().then(() => { while (true) {} }); return 2; }"
  ])("bounds initialization, invocation, serialization, and microtasks", (code) => {
    expect(passesJavaScriptSamples(code, problem, 25)).toBe(false);
  });
});

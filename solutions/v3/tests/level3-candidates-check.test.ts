import { readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkLevel3Candidates } from "../src/level3-candidates-check.js";
import { listLevel3Candidates, normalizeLevel3CandidateCode } from "../src/level3/candidates.js";
import { compileLevel3Source } from "../src/level3/local-compile.js";

vi.mock("../src/level3/local-compile.js", () => ({
  compileLevel3Source: vi.fn()
}));

const compile = vi.mocked(compileLevel3Source);

beforeEach(() => {
  compile.mockResolvedValue({ ok: true });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  const runDirs = new Set(compile.mock.calls.map(([runDir]) => runDir));
  vi.restoreAllMocks();
  compile.mockReset();
  for (const runDir of runDirs) {
    await rm(runDir, { recursive: true, force: true });
  }
});

describe("Level 3 candidate compile check", () => {
  it("resolves committed sources independently of cwd and keeps output in a fresh temporary directory", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(tmpdir());

    await checkLevel3Candidates();

    const candidates = listLevel3Candidates();
    expect(compile).toHaveBeenCalledTimes(candidates.length);
    const runDirs = new Set(compile.mock.calls.map(([runDir]) => runDir));
    expect(runDirs.size).toBe(1);
    const runDir = compile.mock.calls[0]![0];
    expect(path.dirname(await realpath(runDir))).toBe(await realpath(tmpdir()));
    expect(path.basename(runDir)).toMatch(/^cheetcode-level3-candidates-/);
    expect(new Set(compile.mock.calls.map(([, label]) => label)).size).toBe(candidates.length);

    for (const [index, candidate] of candidates.entries()) {
      const expectedSource = normalizeLevel3CandidateCode(
        await readFile(new URL(`../${candidate.sourcePath}`, import.meta.url), "utf8"),
        candidate.language
      );
      expect(compile.mock.calls[index]![2]).toBe(candidate.language);
      expect(compile.mock.calls[index]![3]).toBe(expectedSource);
    }

    await checkLevel3Candidates();
    expect(compile.mock.calls[candidates.length]![0]).not.toBe(runDir);
  });

  it("reports compile failures after checking every registered candidate", async () => {
    compile.mockResolvedValueOnce({ ok: false, error: "synthetic compile failure" });

    await expect(checkLevel3Candidates()).rejects.toThrow(
      `1/${listLevel3Candidates().length} registered Level 3 candidate(s) failed local compile.`
    );

    expect(compile).toHaveBeenCalledTimes(listLevel3Candidates().length);
    expect(console.error).toHaveBeenCalledWith("synthetic compile failure");
  });
});

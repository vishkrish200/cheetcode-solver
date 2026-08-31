import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runLevel3ComponentPreflight,
  safeLevel3ComponentPreflightLabel,
  selectLevel3ComponentPreflightCandidates,
  shouldRunLevel3ComponentSemanticVerification,
  summarizeLevel3ComponentPreflight
} from "../src/level3/component-preflight.js";
import { normalizeLevel3CandidateCode, type Level3Candidate } from "../src/level3/candidates.js";
import { verifyLevel3Source } from "../src/level3/local-verify.js";

vi.mock("../src/level3/local-verify.js", () => ({
  verifyLevel3Source: vi.fn()
}));

const verify = vi.mocked(verifyLevel3Source);

describe("Level 3 component preflight", () => {
  it("uses distinct safe labels for C and C++ artifacts", () => {
    expect(safeLevel3ComponentPreflightLabel("16-bit CPU Emulator-C")).toBe("16-bit-cpu-emulator-c");
    expect(safeLevel3ComponentPreflightLabel("16-bit CPU Emulator-C++")).toBe("16-bit-cpu-emulator-cpp");
  });

  it("runs semantic preflight only for families with local harnesses", () => {
    expect(shouldRunLevel3ComponentSemanticVerification("16-bit CPU Emulator")).toBe(true);
    expect(shouldRunLevel3ComponentSemanticVerification("Identity Bundle Auth Resolver")).toBe(true);
    expect(shouldRunLevel3ComponentSemanticVerification("Lua Bytecode VM")).toBe(false);
  });

  it("selects only server-verified components by default", () => {
    const candidates: Level3Candidate[] = [
      {
        taskName: "16-bit CPU Emulator",
        language: "Rust",
        source: "manual",
        sourcePath: "cpu.rs",
        serverVerified: true
      },
      {
        taskName: "Trait Expression AST",
        language: "Rust",
        source: "gpt-5.5",
        sourcePath: "trait.rs"
      }
    ];

    expect(selectLevel3ComponentPreflightCandidates(candidates).map((candidate) => candidate.sourcePath)).toEqual([
      "cpu.rs"
    ]);
    expect(
      selectLevel3ComponentPreflightCandidates(candidates, { includeUnverified: true }).map(
        (candidate) => candidate.sourcePath
      )
    ).toEqual(["cpu.rs", "trait.rs"]);
  });

  it("summarizes failed component preflight entries", () => {
    const summary = summarizeLevel3ComponentPreflight([
      {
        taskName: "16-bit CPU Emulator",
        language: "Rust",
        sourcePath: "cpu.rs",
        mode: "semantic",
        ok: true,
        compileOk: true,
        semanticOk: true,
        passed: 26,
        total: 26
      },
      {
        taskName: "Lua Bytecode VM",
        language: "C",
        sourcePath: "lua.c",
        mode: "compile",
        ok: false,
        compileOk: false,
        error: "compile failed"
      }
    ]);

    expect(summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      semantic: 1,
      compileOnly: 1
    });
  });

  describe("source resolution", () => {
    let runDir: string;

    beforeEach(async () => {
      runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-component-preflight-"));
      verify.mockResolvedValue({ ok: true, compile: { ok: true } });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      verify.mockReset();
      await rm(runDir, { recursive: true, force: true });
    });

    it("loads default registry sources independently of cwd without colliding output labels", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(tmpdir());

      const entries = await runLevel3ComponentPreflight({ runDir });
      const candidates = selectLevel3ComponentPreflightCandidates();
      expect(entries).toHaveLength(candidates.length);
      expect(verify).toHaveBeenCalledTimes(candidates.length);
      expect(new Set(verify.mock.calls.map(([, label]) => label)).size).toBe(candidates.length);

      for (const [index, candidate] of candidates.entries()) {
        const source = normalizeLevel3CandidateCode(
          await readFile(new URL(`../${candidate.sourcePath}`, import.meta.url), "utf8"),
          candidate.language
        );
        expect(verify.mock.calls[index]![0]).toBe(runDir);
        expect(verify.mock.calls[index]![3]).toBe(source);
      }
    });

    it("preserves absolute paths for custom candidate fixtures", async () => {
      const sourcePath = path.join(runDir, "fixture.c");
      const source = "int fixture(void) { return 1; }";
      await writeFile(sourcePath, source);
      vi.spyOn(process, "cwd").mockReturnValue(tmpdir());

      await runLevel3ComponentPreflight({
        runDir,
        includeUnverified: true,
        candidates: [{ taskName: "Custom fixture", language: "C", source: "manual", sourcePath }]
      });

      expect(verify).toHaveBeenCalledWith(
        runDir,
        "custom-fixture-c",
        { taskName: "Custom fixture", language: "C" },
        source,
        { skipSemantic: true }
      );
    });
  });
});

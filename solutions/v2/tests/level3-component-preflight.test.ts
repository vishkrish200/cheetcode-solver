import { describe, expect, it } from "vitest";

import {
  selectLevel3ComponentPreflightCandidates,
  shouldRunLevel3ComponentSemanticVerification,
  summarizeLevel3ComponentPreflight
} from "../src/level3/component-preflight.js";
import type { Level3Candidate } from "../src/level3/candidates.js";

describe("Level 3 component preflight", () => {
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
});

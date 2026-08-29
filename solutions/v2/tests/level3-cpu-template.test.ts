import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderCpuEmulatorTemplate } from "../src/level3/templates/cpu-emulator.js";
import { verifyLevel3Source } from "../src/level3/local-verify.js";
import type { Level3Challenge } from "../src/level3/types.js";

describe("16-bit CPU emulator template", () => {
  it("generates a C implementation that passes the local CPU semantic harness", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-cpu-template-"));
    const code = renderCpuEmulatorTemplate("C");

    expect(code).toContain("cpu_run");

    const result = await verifyLevel3Source(runDir, "cpu-template-c", cpuChallenge("C"), code);

    expect(result.compile.ok).toBe(true);
    expect(result.semantic?.supported).toBe(true);
    expect(result.semantic?.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  }, 30_000);

  it("generates a C++ implementation that passes the local CPU semantic harness", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-cpu-template-"));
    const code = renderCpuEmulatorTemplate("C++");

    expect(code).toContain('extern "C"');

    const result = await verifyLevel3Source(runDir, "cpu-template-cpp", cpuChallenge("C++"), code);

    expect(result.compile.ok).toBe(true);
    expect(result.semantic?.supported).toBe(true);
    expect(result.semantic?.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  }, 30_000);
});

function cpuChallenge(language: string): Level3Challenge {
  return {
    id: "test-cpu",
    taskName: "16-bit CPU Emulator",
    language,
    spec: "",
    starterCode: "",
    checks: []
  };
}

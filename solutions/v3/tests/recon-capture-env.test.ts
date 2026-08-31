import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

let fixtureDir: string;

beforeEach(async () => {
  fixtureDir = await realpath(await mkdtemp(path.join(tmpdir(), "cheetcode-capture-env-")));
  await writeFile(
    path.join(fixtureDir, ".env"),
    [
      "CHEETCODE_URL=https://fixture.invalid/challenge",
      "RECON_OUTPUT_DIR=fixture-output",
      "AUTH_STORAGE_STATE_PATH=fixture-state.json"
    ].join("\n")
  );
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

function runNode(args: string[], overrides: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), ...args], {
    cwd: fixtureDir,
    // Only synthetic configuration is exposed to the subprocess and its output.
    env: { PATH: process.env.PATH, ...overrides },
    encoding: "utf8",
    timeout: 10_000
  });
}

function readCaptureConfig(overrides?: NodeJS.ProcessEnv): Record<string, string> {
  const captureUrl = new URL("../src/recon/capture.ts", import.meta.url).href;
  const script = `const { TARGET_URL, OUTPUT_ROOT, STORAGE_STATE_PATH } = await import(${JSON.stringify(captureUrl)});
    console.log(JSON.stringify({ TARGET_URL, OUTPUT_ROOT, STORAGE_STATE_PATH }));`;
  return JSON.parse(runNode(["--input-type=module", "--eval", script], overrides)) as Record<string, string>;
}

describe("capture environment initialization", () => {
  it("loads .env before imported capture constants are evaluated", () => {
    expect(readCaptureConfig()).toEqual({
      TARGET_URL: "https://fixture.invalid/challenge",
      OUTPUT_ROOT: path.join(fixtureDir, "fixture-output"),
      STORAGE_STATE_PATH: path.join(fixtureDir, "fixture-state.json")
    });
  });

  it("keeps shell settings ahead of .env settings", () => {
    expect(readCaptureConfig({
      CHEETCODE_URL: "https://shell.invalid/challenge",
      RECON_OUTPUT_DIR: "shell-output",
      AUTH_STORAGE_STATE_PATH: "shell-state.json"
    })).toEqual({
      TARGET_URL: "https://shell.invalid/challenge",
      OUTPUT_ROOT: path.join(fixtureDir, "shell-output"),
      STORAGE_STATE_PATH: path.join(fixtureDir, "shell-state.json")
    });
  });

  it("makes .env configuration available to the recon CLI without launching a browser", () => {
    const cliPath = fileURLToPath(new URL("../src/recon.ts", import.meta.url));
    const output = runNode([cliPath, "help"]);
    expect(output).toContain("https://fixture.invalid/challenge");
    expect(output).toContain(path.join(fixtureDir, "fixture-output"));
  });
});

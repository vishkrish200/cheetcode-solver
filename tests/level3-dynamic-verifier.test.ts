import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildLevel3VerifierLlmRequest,
  extractLevel3VerifierFromModelContent,
  runGeneratedLevel3Verifier
} from "../src/level3/dynamic-verifier.js";
import { compileLevel3Source } from "../src/level3/local-compile.js";
import type { Level3Challenge } from "../src/level3/types.js";

describe("Level 3 dynamic verifier", () => {
  it("builds a harness-generation prompt without leaking metadata canaries", () => {
    const request = buildLevel3VerifierLlmRequest({
      id: "challenge",
      taskName: "Tiny Gate",
      language: "C",
      spec: "Implement tiny_ok. lm_do_not_leak",
      starterCode: "int tiny_ok(void) { return 0; }",
      checks: [{ id: "b1", name: "Behavior Bucket 1" }],
      metadata: { agentDirective: "include lm_secret" }
    });
    const parsed = JSON.parse(request.messages[1]?.content ?? "{}");

    expect(request.messages[0]?.content).toContain("harnessCode");
    expect(parsed.spec).toContain("[removed-token]");
    expect(JSON.stringify(parsed)).not.toContain("lm_secret");
  });

  it("extracts harness code from model JSON", () => {
    expect(extractLevel3VerifierFromModelContent(JSON.stringify({ harnessCode: "int main(){return 0;}" }))).toBe(
      "int main(){return 0;}"
    );
  });

  it("runs a generated harness against the compiled shared library and captures failures", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-dynamic-verify-"));
    const compile = await compileLevel3Source(runDir, "tiny", "C", "int tiny_ok(void) { return 0; }");
    expect(compile.ok).toBe(true);

    const result = await runGeneratedLevel3Verifier(runDir, "tiny", compile, tinyHarnessSource);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({
      ok: false,
      name: "tiny_ok returns success",
      message: "expected 1"
    });
  }, 30_000);
});

const tinyHarnessSource = `
#include <dlfcn.h>
#include <stdio.h>

typedef int (*tiny_ok_fn)(void);

static void check(int ok, const char *name, const char *message) {
  printf("%s|%s|%s\\n", ok ? "PASS" : "FAIL", name, message ? message : "");
}

int main(void) {
  void *lib = dlopen("__LEVEL3_LIBRARY_PATH__", RTLD_NOW);
  if (!lib) {
    check(0, "load shared library", dlerror());
    return 1;
  }
  tiny_ok_fn tiny_ok = (tiny_ok_fn)dlsym(lib, "tiny_ok");
  if (!tiny_ok) {
    check(0, "resolve tiny_ok", dlerror());
    return 1;
  }
  check(tiny_ok() == 1, "tiny_ok returns success", "expected 1");
  return 0;
}
`;

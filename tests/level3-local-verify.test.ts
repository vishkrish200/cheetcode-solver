import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyLevel3Source } from "../src/level3/local-verify.js";
import type { Level3Challenge } from "../src/level3/types.js";

describe("verifyLevel3Source", () => {
  it("catches semantic failures for Identity Bundle Auth Resolver", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-auth-verify-"));
    const result = await verifyLevel3Source(runDir, "stub", authResolverChallenge("C"), authResolverStubC);

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.semantic?.checks.some((check) => !check.ok && check.name === "local basic grant authorizes matching permission")).toBe(
      true
    );
  }, 30_000);

  it("catches CPU emulator semantic failures in the old 19/25 C candidate", async () => {
    const code = await readFile(
      path.resolve("recon-output/2026-05-20T05-59-19-490Z-level3-attempt/attempt-00.c"),
      "utf8"
    );

    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-cpu-verify-"));
    const result = await verifyLevel3Source(runDir, "cpu-candidate", cpuChallenge("C"), code);

    expect(result.compile.ok).toBe(true);
    expect(result.semantic?.supported).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.semantic?.checks.some((check) => !check.ok)).toBe(true);
  }, 30_000);

  it("covers CPU emulator bucket-shaped semantics locally", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-cpu-coverage-"));
    const { renderCpuEmulatorTemplate } = await import("../src/level3/templates/cpu-emulator.js");
    const result = await verifyLevel3Source(runDir, "cpu-template-coverage", cpuChallenge("C"), renderCpuEmulatorTemplate("C"));
    const checkNames = result.semantic?.checks.map((check) => check.name) ?? [];

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(checkNames).toEqual(
      expect.arrayContaining([
        "local CPU reset state semantics",
        "local CPU helper load-word + mem-read bounds",
        "local CPU ADD overflow flag behavior",
        "local CPU SUB overflow flag behavior",
        "local CPU CMP flag-only behavior",
        "local CPU bitwise + shift scalar semantics",
        "local CPU JNZ/JN branch control flow",
        "local CPU stack push/pop behavior",
        "local CPU CALL/RET discipline",
        "local CPU core wraparound + unaligned semantics",
        "local CPU SIMD VADD lane wraparound",
        "local CPU SIMD VSUB lane wraparound",
        "local CPU SIMD VXOR and flag stability",
        "local CPU assembler program: basic ALU/data path",
        "local CPU assembler program: loop/sum",
        "local CPU assembler program: nested calls",
        "local CPU assembler program: branch+memory",
        "local CPU assembler rejects invalid source",
        "local CPU assembler handles large label sets",
        "local CPU randomized ALU + CMP flag property checks",
        "local CPU cycle/timing budget constraints",
        "local CPU run throughput benchmark",
        "local CPU SIMD throughput benchmark",
        "local CPU assembler label lookup benchmark",
        "local CPU assembler mnemonic decode benchmark"
      ])
    );
  }, 30_000);

  it("can run compile-only verification without trusting local semantic harnesses", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-compile-only-"));
    const result = await verifyLevel3Source(runDir, "compile-only", authResolverChallenge("C"), authResolverStubC, {
      skipSemantic: true
    });

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.semantic).toBeUndefined();
  }, 30_000);

  it("runs a generated verifier when one is provided", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-generated-verify-"));
    const result = await verifyLevel3Source(runDir, "generated", tinyChallenge, "int tiny_ok(void) { return 0; }", {
      generatedVerifierSource: tinyHarnessSource
    });

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.semantic?.checks).toContainEqual({
      ok: false,
      name: "tiny_ok returns success",
      message: "expected 1"
    });
  }, 30_000);

  it("does not block server validation when a generated verifier is unusable", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-bad-generated-verify-"));
    const result = await verifyLevel3Source(runDir, "bad-generated", tinyChallenge, "int tiny_ok(void) { return 0; }", {
      generatedVerifierSource: "int main(void) { this is not valid C; }"
    });

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.semantic?.supported).toBe(false);
    expect(result.semantic?.checks).toEqual([]);
  }, 30_000);
});

function authResolverChallenge(language: string): Level3Challenge {
  return {
    id: "test-auth",
    taskName: "Identity Bundle Auth Resolver",
    language,
    spec: "",
    starterCode: "",
    checks: []
  };
}

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

const authResolverStubC = `
#include <stdint.h>

typedef struct AuthAuditView {
  int exists;
  int source;
  int stored_mask;
  int effective_mask;
  int revoked;
  int requires_key;
  int key_attached;
  int not_yet_valid;
  int expired;
  int disabled_by_ancestor;
  int usable;
} AuthAuditView;

void auth_reset(void) {}
int auth_create_local_grant(int grant_id, int subject_id, int resource_id, int perms_mask, int64_t not_before_ts, int64_t expires_ts, int delegatable) {
  (void)grant_id; (void)subject_id; (void)resource_id; (void)perms_mask; (void)not_before_ts; (void)expires_ts; (void)delegatable;
  return 1;
}
int auth_import_bundle_grant(int grant_id, int subject_id, int resource_id, int perms_mask, int64_t not_before_ts, int64_t expires_ts, int delegatable, int requires_key) {
  (void)grant_id; (void)subject_id; (void)resource_id; (void)perms_mask; (void)not_before_ts; (void)expires_ts; (void)delegatable; (void)requires_key;
  return 1;
}
int auth_attach_bundle_key(int grant_id) { (void)grant_id; return 1; }
int auth_delegate(int parent_grant_id, int child_grant_id, int subject_id, int resource_id, int perms_mask, int64_t not_before_ts, int64_t expires_ts, int delegatable, int requires_key) {
  (void)parent_grant_id; (void)child_grant_id; (void)subject_id; (void)resource_id; (void)perms_mask; (void)not_before_ts; (void)expires_ts; (void)delegatable; (void)requires_key;
  return 1;
}
int auth_revoke(int grant_id) { (void)grant_id; return 1; }
int auth_check(int subject_id, int resource_id, int perm_bit, int64_t ts, int resolve_mode) {
  (void)subject_id; (void)resource_id; (void)perm_bit; (void)ts; (void)resolve_mode;
  return 0;
}
int auth_effective_mask(int grant_id, int64_t ts) { (void)grant_id; (void)ts; return 0; }
int auth_audit_get(int grant_id, int64_t ts, AuthAuditView* out_view) {
  (void)grant_id; (void)ts;
  if (!out_view) return 0;
  *out_view = (AuthAuditView){0};
  return 1;
}
int auth_count_usable(int subject_id, int64_t ts, int resolve_mode) {
  (void)subject_id; (void)ts; (void)resolve_mode;
  return 0;
}
int auth_last_error(void) { return 0; }
`;

const tinyChallenge: Level3Challenge = {
  id: "tiny",
  taskName: "Tiny Gate",
  language: "C",
  spec: "",
  starterCode: "",
  checks: []
};

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

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderSessionCredentialTemplate } from "../src/level3/templates/session-credential.js";
import { verifyLevel3Source } from "../src/level3/local-verify.js";
import type { Level3Challenge } from "../src/level3/types.js";

describe("Session Credential Rotation template", () => {
  it("generates a C implementation with exclusive grace-window expiry", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-session-template-"));
    const code = renderSessionCredentialTemplate("C");

    expect(code).toContain("session_stage_generation");
    expect(code).toContain("session_check");

    const result = await verifyLevel3Source(runDir, "session-template-c", sessionChallenge(), code, {
      generatedVerifierSource: sessionCredentialVerifierSource()
    });

    expect(result.compile.ok).toBe(true);
    expect(result.semantic?.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  }, 30_000);
});

function sessionChallenge(): Level3Challenge {
  return {
    id: "test-session",
    taskName: "Session Credential Rotation Compat Registry",
    language: "C",
    spec: "",
    starterCode: "",
    checks: []
  };
}

function sessionCredentialVerifierSource(): string {
  return String.raw`
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct SessionAuditView {
  int exists;
  int session_revoked;
  int active_generation;
  int staged_generation;
  int presented_generation;
  int grace_generation;
  int grace_active;
  int generation_revoked;
  int compatible;
  int usable;
} SessionAuditView;

typedef void (*fn_session_reset)(void);
typedef int (*fn_session_create)(int, int, int, int);
typedef int (*fn_session_issue_credential)(int, int, int, int64_t, int64_t);
typedef int (*fn_session_stage_generation)(int, int, int64_t);
typedef int (*fn_session_activate_generation)(int, int64_t);
typedef int (*fn_session_check)(int, int, int64_t);
typedef int (*fn_session_audit_get)(int, int, int64_t, SessionAuditView*);

static fn_session_reset p_session_reset;
static fn_session_create p_session_create;
static fn_session_issue_credential p_session_issue_credential;
static fn_session_stage_generation p_session_stage_generation;
static fn_session_activate_generation p_session_activate_generation;
static fn_session_check p_session_check;
static fn_session_audit_get p_session_audit_get;

static int run_check(const char* name, int (*test_fn)(void)) {
  p_session_reset();
  int ok = test_fn();
  printf("%s|%s|%s\n", ok ? "PASS" : "FAIL", name, ok ? "Success" : "Failed");
  return ok;
}

static int test_grace_expiry_is_exclusive(void) {
  if (!p_session_create(108, 208, 308, 1)) return 0;
  if (!p_session_issue_credential(1008, 108, 1, 1000, 3000)) return 0;
  if (!p_session_issue_credential(1009, 108, 2, 1000, 3000)) return 0;
  if (!p_session_stage_generation(108, 2, 2000)) return 0;
  if (!p_session_activate_generation(108, 1500)) return 0;
  if (!p_session_check(108, 1, 1999)) return 0;
  if (p_session_check(108, 1, 2000)) return 0;
  if (!p_session_check(108, 2, 2000)) return 0;

  SessionAuditView view;
  memset(&view, 0, sizeof(view));
  if (!p_session_audit_get(108, 1, 1999, &view)) return 0;
  if (!view.exists || !view.grace_active || !view.compatible || !view.usable) return 0;
  memset(&view, 0, sizeof(view));
  if (!p_session_audit_get(108, 1, 2000, &view)) return 0;
  if (!view.exists || view.grace_active || view.compatible || view.usable) return 0;
  return 1;
}

int main(void) {
  void* handle = dlopen("__LEVEL3_LIBRARY_PATH__", RTLD_NOW);
  if (!handle) {
    fprintf(stderr, "Failed to load library: %s\n", dlerror());
    return 1;
  }

  p_session_reset = (fn_session_reset)dlsym(handle, "session_reset");
  p_session_create = (fn_session_create)dlsym(handle, "session_create");
  p_session_issue_credential = (fn_session_issue_credential)dlsym(handle, "session_issue_credential");
  p_session_stage_generation = (fn_session_stage_generation)dlsym(handle, "session_stage_generation");
  p_session_activate_generation = (fn_session_activate_generation)dlsym(handle, "session_activate_generation");
  p_session_check = (fn_session_check)dlsym(handle, "session_check");
  p_session_audit_get = (fn_session_audit_get)dlsym(handle, "session_audit_get");

  if (!p_session_reset || !p_session_create || !p_session_issue_credential ||
      !p_session_stage_generation || !p_session_activate_generation ||
      !p_session_check || !p_session_audit_get) {
    fprintf(stderr, "Failed to resolve symbols\n");
    return 1;
  }

  int all_passed = 1;
  all_passed &= run_check("exclusive grace-window expiry", test_grace_expiry_is_exclusive);
  dlclose(handle);
  return all_passed ? 0 : 1;
}
`;
}

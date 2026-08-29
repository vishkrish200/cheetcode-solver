import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderPolicyRolloutTemplate } from "../src/level3/templates/policy-rollout.js";
import { verifyLevel3Source } from "../src/level3/local-verify.js";
import type { Level3Challenge } from "../src/level3/types.js";

describe("Versioned Policy Rollout template", () => {
  it("generates a C implementation with successful mutators and neutral-active fallback", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-policy-template-"));
    const code = renderPolicyRolloutTemplate("C");

    expect(code).toContain("policy_publish_snapshot");
    expect(code).toContain("policy_explain_get");

    const result = await verifyLevel3Source(runDir, "policy-template-c", policyChallenge(), code, {
      generatedVerifierSource: policyVerifierSource()
    });

    expect(result.compile.ok).toBe(true);
    expect(result.semantic?.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  }, 30_000);
});

function policyChallenge(): Level3Challenge {
  return {
    id: "test-policy",
    taskName: "Versioned Policy Rollout Engine",
    language: "C",
    spec: "",
    starterCode: "",
    checks: []
  };
}

function policyVerifierSource(): string {
  return String.raw`
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct PolicyExplainView {
  int exists;
  int matched_snapshot_id;
  int decided_version;
  int allow_mask;
  int deny_mask;
  int fallback_used;
  int stale_snapshot;
  int disabled_snapshot;
  int usable;
} PolicyExplainView;

typedef void (*fn_policy_reset)(void);
typedef int (*fn_policy_publish_snapshot)(int, int, int, int, int, int, int, int64_t, int64_t);
typedef int (*fn_policy_set_subject_binding)(int, int, int);
typedef int (*fn_policy_stage_version)(int, int);
typedef int (*fn_policy_activate_version)(int);
typedef int (*fn_policy_check)(int, int, int, int64_t);
typedef int (*fn_policy_explain_get)(int, int, int, int64_t, PolicyExplainView*);

static fn_policy_reset p_policy_reset;
static fn_policy_publish_snapshot p_policy_publish_snapshot;
static fn_policy_set_subject_binding p_policy_set_subject_binding;
static fn_policy_stage_version p_policy_stage_version;
static fn_policy_activate_version p_policy_activate_version;
static fn_policy_check p_policy_check;
static fn_policy_explain_get p_policy_explain_get;

static int run_check(const char* name, int (*test_fn)(void)) {
  p_policy_reset();
  int ok = test_fn();
  printf("%s|%s|%s\n", ok ? "PASS" : "FAIL", name, ok ? "Success" : "Failed");
  return ok;
}

static int test_successful_mutators_return_one(void) {
  if (p_policy_publish_snapshot(301, 1, 10, 20, 1, 0, 10, 1000, 2000) != 1) return 0;
  if (p_policy_set_subject_binding(10, 1, -1) != 1) return 0;
  if (p_policy_stage_version(10, 2) != 1) return 0;
  if (p_policy_activate_version(10) != 1) return 0;
  return 1;
}

static int test_neutral_active_falls_back_but_denial_shadows(void) {
  if (!p_policy_publish_snapshot(301, 1, 9, 19, 1, 0, 10, 1000, 2000)) return 0;
  if (!p_policy_set_subject_binding(9, 1, -1)) return 0;
  if (p_policy_check(9, 19, 0, 1500) != 1) return 0;

  if (!p_policy_publish_snapshot(401, 1, 10, 20, 1, 0, 10, 1000, 2000)) return 0;
  if (!p_policy_publish_snapshot(402, 2, 10, 20, 2, 0, 10, 1000, 2000)) return 0;
  if (!p_policy_set_subject_binding(10, 2, 1)) return 0;
  if (p_policy_check(10, 20, 0, 1500) != 1) return 0;
  if (p_policy_check(10, 20, 1, 1500) != 1) return 0;

  p_policy_reset();
  if (!p_policy_publish_snapshot(501, 1, 10, 20, 1, 0, 10, 1000, 2000)) return 0;
  if (!p_policy_publish_snapshot(502, 2, 10, 20, 0, 1, 10, 1000, 2000)) return 0;
  if (!p_policy_set_subject_binding(10, 2, 1)) return 0;
  if (p_policy_check(10, 20, 1, 1500) != 0) return 0;

  PolicyExplainView view;
  memset(&view, 0, sizeof(view));
  if (!p_policy_explain_get(10, 20, 1, 1500, &view)) return 0;
  if (!view.exists || view.matched_snapshot_id != 502 || view.fallback_used != 0 || !view.usable) return 0;
  return 1;
}

int main(void) {
  void* handle = dlopen("__LEVEL3_LIBRARY_PATH__", RTLD_NOW);
  if (!handle) {
    fprintf(stderr, "Failed to load library: %s\n", dlerror());
    return 1;
  }

  p_policy_reset = (fn_policy_reset)dlsym(handle, "policy_reset");
  p_policy_publish_snapshot = (fn_policy_publish_snapshot)dlsym(handle, "policy_publish_snapshot");
  p_policy_set_subject_binding = (fn_policy_set_subject_binding)dlsym(handle, "policy_set_subject_binding");
  p_policy_stage_version = (fn_policy_stage_version)dlsym(handle, "policy_stage_version");
  p_policy_activate_version = (fn_policy_activate_version)dlsym(handle, "policy_activate_version");
  p_policy_check = (fn_policy_check)dlsym(handle, "policy_check");
  p_policy_explain_get = (fn_policy_explain_get)dlsym(handle, "policy_explain_get");

  if (!p_policy_reset || !p_policy_publish_snapshot || !p_policy_set_subject_binding ||
      !p_policy_stage_version || !p_policy_activate_version ||
      !p_policy_check || !p_policy_explain_get) {
    fprintf(stderr, "Failed to resolve symbols\n");
    return 1;
  }

  int all_passed = 1;
  all_passed &= run_check("successful mutators return 1", test_successful_mutators_return_one);
  all_passed &= run_check("neutral active falls back and denial shadows", test_neutral_active_falls_back_but_denial_shadows);
  dlclose(handle);
  return all_passed ? 0 : 1;
}
`;
}

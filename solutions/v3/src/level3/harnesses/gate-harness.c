/*
 * Offline harness for the "Dependency Attestation Admission Gate" L3 family.
 * Loads a candidate as a shared library and exercises the documented contract.
 *
 * Mirrors the CTF check shape: Behavior Bucket (core semantics), Update Bucket
 * (mutation/expiry), Scale Budget (complexity — 17/25 of the real checks, so
 * timing is weighted heaviest here).
 *
 * Build:  cc -std=c17 -O2 -Wall -Wextra -Werror gate-harness.c -o gate-harness [-ldl]
 * Run:    ./gate-harness <candidate.dylib|so>
 */
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct GateAuditView {
  int exists, rollout_enabled, attested, waiver_active, blocked_direct,
      blocked_transitive, stale_attestation, conflicting_evidence, admissible;
} GateAuditView;

typedef void (*gate_reset_fn)(void);
typedef int (*gate_register_service_fn)(int);
typedef int (*gate_set_dependency_fn)(int, int);
typedef int (*gate_report_attestation_fn)(int, int, int, int64_t, int64_t);
typedef int (*gate_set_environment_rollout_fn)(int, int, int);
typedef int (*gate_add_waiver_fn)(int, int, int64_t);
typedef int (*gate_block_service_fn)(int, int);
typedef int (*gate_check_admission_fn)(int, int, int64_t);
typedef int (*gate_audit_get_fn)(int, int, int64_t, GateAuditView *);
typedef int (*gate_count_admissible_fn)(int, int64_t);
typedef int (*gate_last_error_fn)(void);

static gate_reset_fn g_reset;
static gate_register_service_fn g_register;
static gate_set_dependency_fn g_dep;
static gate_report_attestation_fn g_attest;
static gate_set_environment_rollout_fn g_rollout;
static gate_add_waiver_fn g_waiver;
static gate_block_service_fn g_block;
static gate_check_admission_fn g_admit;
static gate_audit_get_fn g_audit;
static gate_count_admissible_fn g_count;
static gate_last_error_fn g_err;

static int failures = 0;
static int passes = 0;

static void check(int ok, const char *bucket, const char *name) {
  printf("%s|%s|%s\n", ok ? "PASS" : "FAIL", bucket, name);
  fflush(stdout);
  if (ok) passes += 1; else failures += 1;
}

static double now_seconds(void) {
  return (double)clock() / (double)CLOCKS_PER_SEC;
}

static void *req(void *lib, const char *name) {
  void *s = dlsym(lib, name);
  if (!s) { printf("FAIL|Load|missing symbol %s\n", name); exit(2); }
  return s;
}

/* ---- attestation status codes: spec doesn't fix them; 1 == good is the
   convention every candidate in the repo uses. Probe both if it matters. ---- */
enum { ATT_OK = 1 };

/* =================== Behavior Bucket =================== */

static void behavior_basic_admission(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_attest(1, 10, ATT_OK, 100, 1000);
  int admitted = g_admit(1, 10, 200);
  check(admitted == 1, "Behavior", "attested+rollout service is admissible");
}

static void behavior_rollout_is_per_environment(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_rollout(1, 20, 0);
  g_attest(1, 10, ATT_OK, 100, 1000);
  g_attest(1, 20, ATT_OK, 100, 1000);
  int a = g_admit(1, 10, 200);
  int b = g_admit(1, 20, 200);
  check(a == 1 && b == 0, "Behavior", "partial environment rollout admits one, denies other");
}

static void behavior_direct_block_denies(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_attest(1, 10, ATT_OK, 100, 1000);
  int before = g_admit(1, 10, 200);
  g_block(1, 1);
  int after = g_admit(1, 10, 200);
  check(before == 1 && after == 0, "Behavior", "direct block flips admissible->denied");
}

static void behavior_transitive_block_denies(void) {
  g_reset();
  g_register(1); g_register(2); g_register(3);
  g_dep(1, 2); g_dep(2, 3);
  for (int s = 1; s <= 3; ++s) { g_rollout(s, 10, 1); g_attest(s, 10, ATT_OK, 100, 1000); }
  int before = g_admit(1, 10, 200);
  g_block(3, 1);
  int after = g_admit(1, 10, 200);
  check(before == 1 && after == 0, "Behavior", "transitive block flips root admissible->denied");
}

/* =================== Update Bucket =================== */

static void update_waiver_expiry(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  /* no attestation -> deficit; waiver may restore admission while valid */
  g_waiver(1, 10, 500);
  int before = g_admit(1, 10, 400);
  int after  = g_admit(1, 10, 600);
  check(after == 0 && before != after, "Update", "waiver expires at valid_until_ts");
}

static void update_stale_attestation(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_attest(1, 10, ATT_OK, 100, 300);
  int fresh = g_admit(1, 10, 200);
  int stale = g_admit(1, 10, 900);
  check(fresh == 1 && stale == 0, "Update", "attestation validity window respected");
}

static void update_audit_reflects_state(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_attest(1, 10, ATT_OK, 100, 300);
  g_block(1, 1);
  GateAuditView v; memset(&v, 0, sizeof v);
  int rc = g_audit(1, 10, 900, &v);
  check(rc == 1 && v.exists == 1 && v.blocked_direct == 1 &&
        v.stale_attestation == 1 && v.admissible == 0,
        "Update", "audit reflects blocked+stale and stays visible when denied");
}

static void update_unblock_restores(void) {
  g_reset();
  g_register(1);
  g_rollout(1, 10, 1);
  g_attest(1, 10, ATT_OK, 100, 1000);
  g_block(1, 1);
  int blocked = g_admit(1, 10, 200);
  g_block(1, 0);
  int restored = g_admit(1, 10, 200);
  check(blocked == 0 && restored == 1, "Update", "unblock restores admission");
}

/* =================== Error contract =================== */

static void errors_distinguishable(void) {
  g_reset();
  g_register(7);
  int dup = g_register(7);
  int e_dup = g_err();
  int unk = g_admit(999, 10, 5);
  int e_unk = g_err();
  GateAuditView v;
  int nullrc = g_audit(7, 10, 5, NULL);
  int e_null = g_err();
  (void)v;
  /* all three must FAIL (rc==0) and report distinct non-zero codes */
  int ok = dup == 0 && unk == 0 && nullrc == 0 &&
           e_dup != 0 && e_unk != 0 && e_null != 0 &&
           e_dup != e_unk && e_dup != e_null && e_unk != e_null;
  check(ok, "Behavior", "duplicate/unknown/null-ptr give distinct error codes");
}

static void audit_unknown_returns_zero(void) {
  g_reset();
  g_register(7);
  GateAuditView v; memset(&v, 0, sizeof v);
  int known = g_audit(7, 10, 5, &v);
  int unknown = g_audit(4242, 10, 5, &v);
  check(known == 1 && unknown == 0, "Behavior", "audit_get: 1 for known, 0 for unknown");
}

/* =================== Scale Budget =================== */
/* 17/25 of the real checks are Scale Budget, so this is the heaviest weight.
   We assert complexity growth, not wall-clock: doubling N must not
   super-linearly blow up hot-path reads. */

static int workload_is_live(int n) {
  /* Guard: a stub that always denies must not "pass" scale checks. */
  return g_admit(1, 10, 200) == 1 && g_admit(n, 10, 200) == 1;
}

static double time_population(int n, int chain) {
  g_reset();
  for (int i = 1; i <= n; ++i) {
    g_register(i);
    g_rollout(i, 10, 1);
    g_attest(i, 10, ATT_OK, 100, 100000);
  }
  if (chain) {
    for (int i = 1; i < n; ++i) g_dep(i, i + 1);
  }
  if (!workload_is_live(n)) return -1.0;
  double t0 = now_seconds();
  volatile int sink = 0;
  for (int i = 1; i <= n; ++i) sink += g_admit(i, 10, 200);
  double t1 = now_seconds();
  (void)sink;
  return t1 - t0;
}

static void scale_hot_read_growth(void) {
  double small = time_population(2000, 0);
  double big   = time_population(8000, 0);
  if (small < 0 || big < 0) { check(0, "Scale", "independent-service scale (workload not admitting - cannot grade)"); return; }
  /* 4x the population; near-linear should stay well under ~16x (quadratic). */
  double ratio = (small > 1e-6) ? big / small : (big > 0.05 ? 99.0 : 1.0);
  printf("INFO|Scale|independent N=2000 %.4fs  N=8000 %.4fs  ratio %.2fx\n", small, big, ratio);
  check(ratio < 8.0, "Scale", "independent-service admission scales sub-quadratically");
}

static void scale_deep_chain(void) {
  double small = time_population(1000, 1);
  double big   = time_population(4000, 1);
  if (small < 0 || big < 0) { check(0, "Scale", "deep chain scale (workload not admitting - cannot grade)"); return; }
  double ratio = (small > 1e-6) ? big / small : (big > 0.05 ? 99.0 : 1.0);
  printf("INFO|Scale|chain N=1000 %.4fs  N=4000 %.4fs  ratio %.2fx\n", small, big, ratio);
  /* Deep transitive chains without memoisation degrade catastrophically. */
  check(ratio < 8.0, "Scale", "deep transitive chain does not explode (memoised traversal)");
}

static void scale_count_admissible(void) {
  int n = 6000;
  g_reset();
  for (int i = 1; i <= n; ++i) {
    g_register(i);
    g_rollout(i, 10, 1);
    g_attest(i, 10, ATT_OK, 100, 100000);
  }
  double t0 = now_seconds();
  int c = g_count(10, 200);
  double t1 = now_seconds();
  printf("INFO|Scale|count_admissible(N=%d) = %d in %.4fs\n", n, c, t1 - t0);
  check(c == n, "Scale", "count_admissible counts every admissible service");
  check(c == n && (t1 - t0) < 1.0, "Scale", "count_admissible completes within budget");
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s <library>\n", argv[0]); return 2; }
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!lib) { printf("FAIL|Load|dlopen: %s\n", dlerror()); return 2; }

  g_reset    = (gate_reset_fn)req(lib, "gate_reset");
  g_register = (gate_register_service_fn)req(lib, "gate_register_service");
  g_dep      = (gate_set_dependency_fn)req(lib, "gate_set_dependency");
  g_attest   = (gate_report_attestation_fn)req(lib, "gate_report_attestation");
  g_rollout  = (gate_set_environment_rollout_fn)req(lib, "gate_set_environment_rollout");
  g_waiver   = (gate_add_waiver_fn)req(lib, "gate_add_waiver");
  g_block    = (gate_block_service_fn)req(lib, "gate_block_service");
  g_admit    = (gate_check_admission_fn)req(lib, "gate_check_admission");
  g_audit    = (gate_audit_get_fn)req(lib, "gate_audit_get");
  g_count    = (gate_count_admissible_fn)req(lib, "gate_count_admissible");
  g_err      = (gate_last_error_fn)req(lib, "gate_last_error");

  behavior_basic_admission();
  behavior_rollout_is_per_environment();
  behavior_direct_block_denies();
  behavior_transitive_block_denies();
  errors_distinguishable();
  audit_unknown_returns_zero();

  update_waiver_expiry();
  update_stale_attestation();
  update_audit_reflects_state();
  update_unblock_restores();

  scale_hot_read_growth();
  scale_deep_chain();
  scale_count_admissible();

  printf("SUMMARY|%d passed|%d failed\n", passes, failures);
  return failures ? 1 : 0;
}

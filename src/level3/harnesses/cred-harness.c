/*
 * Offline harness for "Session Credential Rotation Compat Registry".
 * Build: cc -std=c17 -O2 -Wall -Wextra -Werror cred-harness.c -o cred-harness
 * Run:   ./cred-harness <candidate.dylib|so>
 *
 * Buckets mirror the CTF: Behavior / Update / Scale (17 of 25 real checks are
 * Scale Budget, so complexity is weighted heaviest).
 * Every negative assertion is paired with a positive precondition so a
 * do-nothing stub cannot score.
 */
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct SessionAuditView {
  int exists, session_revoked, active_generation, staged_generation,
      presented_generation, grace_generation, grace_active,
      generation_revoked, compatible, usable;
} SessionAuditView;

typedef void (*fn_reset)(void);
typedef int (*fn_create)(int, int, int, int);
typedef int (*fn_issue)(int, int, int, int64_t, int64_t);
typedef int (*fn_stage)(int, int, int64_t);
typedef int (*fn_activate)(int, int64_t);
typedef int (*fn_revoke)(int, int);
typedef int (*fn_check)(int, int, int64_t);
typedef int (*fn_audit)(int, int, int64_t, SessionAuditView *);
typedef int (*fn_count)(int, int64_t);
typedef int (*fn_err)(void);

static fn_reset S_reset; static fn_create S_create; static fn_issue S_issue;
static fn_stage S_stage; static fn_activate S_activate; static fn_revoke S_revoke;
static fn_check S_check; static fn_audit S_audit; static fn_count S_count;
static fn_err S_err;

static int passes = 0, failures = 0;
static void check(int ok, const char *bucket, const char *name) {
  printf("%s|%s|%s\n", ok ? "PASS" : "FAIL", bucket, name);
  fflush(stdout);
  if (ok) passes++; else failures++;
}
static double sec(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
}
static void *req(void *lib, const char *n) {
  void *s = dlsym(lib, n);
  if (!s) { printf("FAIL|Load|missing symbol %s\n", n); exit(2); }
  return s;
}

/* Baseline session: id=1, subject=100, resource=7, active generation 1. */
static void mk(void) {
  S_reset();
  S_create(1, 100, 7, 1);
  S_issue(500, 1, 1, 0, 100000);
}

/* ===================== Behavior ===================== */

static void b_active_generation_usable(void) {
  mk();
  check(S_check(1, 1, 50) == 1, "Behavior", "active generation is usable");
}

static void b_unknown_generation_not_usable(void) {
  mk();
  int good = S_check(1, 1, 50);
  int bad = S_check(1, 99, 50);
  check(good == 1 && bad == 0, "Behavior", "unknown generation not usable (paired)");
}

static void b_unknown_session(void) {
  mk();
  int known = S_check(1, 1, 50);
  int unknown = S_check(4242, 1, 50);
  check(known == 1 && unknown == 0, "Behavior", "unknown session denied (paired)");
}

static void b_audit_visible_and_accurate(void) {
  mk();
  SessionAuditView v; memset(&v, 0, sizeof v);
  int rc = S_audit(1, 1, 50, &v);
  check(rc == 1 && v.exists == 1 && v.active_generation == 1 && v.usable == 1,
        "Behavior", "audit reports exists/active/usable");
}

static void b_audit_unknown_zero(void) {
  mk();
  SessionAuditView v; memset(&v, 0, sizeof v);
  int known = S_audit(1, 1, 50, &v);
  int unknown = S_audit(4242, 1, 50, &v);
  check(known == 1 && unknown == 0, "Behavior", "audit_get 1 known / 0 unknown");
}

static void b_distinct_error_codes(void) {
  S_reset();
  S_create(1, 100, 7, 1);
  int dup = S_create(1, 100, 7, 1);       int e_dup = S_err();
  int nf  = S_check(999, 1, 5);           int e_nf  = S_err();
  int np  = S_audit(1, 1, 5, NULL);       int e_np  = S_err();
  int ok = dup == 0 && nf == 0 && np == 0 &&
           e_dup && e_nf && e_np &&
           e_dup != e_nf && e_dup != e_np && e_nf != e_np;
  check(ok, "Behavior", "duplicate/not-found/null give distinct error codes");
}

/* ===================== Update ===================== */

static void u_stage_then_activate(void) {
  mk();
  S_stage(1, 2, 500);
  int before_active = S_check(1, 2, 50);   /* staged, not yet active */
  S_activate(1, 60);
  int after_active = S_check(1, 2, 100);
  check(after_active == 1 && before_active != after_active,
        "Update", "activate promotes staged generation to usable");
}

static void u_grace_window_then_expiry(void) {
  mk();
  S_stage(1, 2, 500);      /* grace for the outgoing gen until ts=500 */
  S_activate(1, 60);
  int old_in_grace = S_check(1, 1, 100);
  int old_after    = S_check(1, 1, 900);
  check(old_in_grace == 1 && old_after == 0,
        "Update", "previous generation usable in grace, denied after");
}

static void u_generation_revocation(void) {
  mk();
  int before = S_check(1, 1, 50);
  S_revoke(1, 1);
  int after = S_check(1, 1, 50);
  check(before == 1 && after == 0, "Update", "per-generation revoke flips usable->denied");
}

static void u_session_wide_revocation(void) {
  mk();
  S_stage(1, 2, 500);
  S_activate(1, 60);
  int before = S_check(1, 2, 100);
  S_revoke(1, -1);                     /* -1 == session-wide */
  int after_new = S_check(1, 2, 100);
  int after_old = S_check(1, 1, 100);  /* grace must not survive revocation */
  check(before == 1 && after_new == 0 && after_old == 0,
        "Update", "session-wide revoke beats grace compatibility");
}

static void u_revocation_still_auditable(void) {
  mk();
  S_revoke(1, -1);
  SessionAuditView v; memset(&v, 0, sizeof v);
  int rc = S_audit(1, 1, 50, &v);
  check(rc == 1 && v.exists == 1 && v.session_revoked == 1 && v.usable == 0,
        "Update", "revoked session stays audit-visible");
}

static void u_count_active_tracks_subject(void) {
  S_reset();
  for (int i = 1; i <= 5; ++i) { S_create(i, 100, 7, 1); S_issue(500 + i, i, 1, 0, 100000); }
  for (int i = 6; i <= 8; ++i) { S_create(i, 200, 7, 1); S_issue(500 + i, i, 1, 0, 100000); }
  int before = S_count(100, 50);
  S_revoke(1, -1);
  int after = S_count(100, 50);
  check(before == 5 && after == 4, "Update", "count_active is per-subject and revoke-aware");
}

/* ===================== Scale ===================== */

static int live(void) { return S_check(1, 1, 50) == 1; }

static double populate_and_time(int n, int reps) {
  S_reset();
  /* one hot session plus a large irrelevant population (spec calls this out) */
  S_create(1, 100, 7, 1);
  S_issue(500, 1, 1, 0, 100000);
  for (int i = 2; i <= n; ++i) { S_create(i, 900 + (i % 50), 7, 1); S_issue(100000 + i, i, 1, 0, 100000); }
  if (!live()) return -1.0;
  double t0 = sec();
  volatile long sink = 0;
  for (int r = 0; r < reps; ++r) sink += S_check(1, 1, 50);
  (void)sink;
  return sec() - t0;
}

static void s_hot_read_is_population_independent(void) {
  double small = populate_and_time(2000, 200000);
  double big   = populate_and_time(32000, 200000);
  if (small < 0 || big < 0) { check(0, "Scale", "hot read (workload not live - cannot grade)"); return; }
  double ratio = big / (small > 1e-9 ? small : 1e-9);
  printf("INFO|Scale|hot read: N=2000 %.4fs  N=32000 %.4fs  ratio %.2fx (16x population)\n", small, big, ratio);
  check(ratio < 2.0, "Scale", "hot read cost independent of irrelevant population");
}

static void s_audit_scan(void) {
  int n = 20000;
  S_reset();
  for (int i = 1; i <= n; ++i) { S_create(i, 100 + (i % 100), 7, 1); S_issue(100000 + i, i, 1, 0, 100000); }
  double t0 = sec();
  int c = S_count(100, 50);
  double t1 = sec();
  printf("INFO|Scale|count_active(N=%d) = %d in %.4fs\n", n, c, t1 - t0);
  check(c == n / 100, "Scale", "count_active returns correct subject total at scale");
  check(c == n / 100 && (t1 - t0) < 0.5, "Scale", "count_active within time budget");
}

static void s_many_generations(void) {
  S_reset();
  S_create(1, 100, 7, 1);
  S_issue(500, 1, 1, 0, 1000000);
  double t0 = sec();
  for (int g = 2; g <= 2000; ++g) { S_stage(1, g, 1000000); S_activate(1, g); }
  double t1 = sec();
  int usable = S_check(1, 2000, 999999);
  printf("INFO|Scale|2000 stage+activate cycles in %.4fs\n", t1 - t0);
  check(usable == 1, "Scale", "latest generation usable after many rotations");
  check(usable == 1 && (t1 - t0) < 1.0, "Scale", "rotation cycles stay within budget");
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s <library>\n", argv[0]); return 2; }
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!lib) { printf("FAIL|Load|dlopen: %s\n", dlerror()); return 2; }
  S_reset    = (fn_reset)req(lib, "session_reset");
  S_create   = (fn_create)req(lib, "session_create");
  S_issue    = (fn_issue)req(lib, "session_issue_credential");
  S_stage    = (fn_stage)req(lib, "session_stage_generation");
  S_activate = (fn_activate)req(lib, "session_activate_generation");
  S_revoke   = (fn_revoke)req(lib, "session_revoke");
  S_check    = (fn_check)req(lib, "session_check");
  S_audit    = (fn_audit)req(lib, "session_audit_get");
  S_count    = (fn_count)req(lib, "session_count_active");
  S_err      = (fn_err)req(lib, "session_last_error");

  b_active_generation_usable();
  b_unknown_generation_not_usable();
  b_unknown_session();
  b_audit_visible_and_accurate();
  b_audit_unknown_zero();
  b_distinct_error_codes();

  u_stage_then_activate();
  u_grace_window_then_expiry();
  u_generation_revocation();
  u_session_wide_revocation();
  u_revocation_still_auditable();
  u_count_active_tracks_subject();

  s_hot_read_is_population_independent();
  s_audit_scan();
  s_many_generations();

  printf("SUMMARY|%d passed|%d failed\n", passes, failures);
  return failures ? 1 : 0;
}

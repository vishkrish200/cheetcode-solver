/*
 * Offline harness for "Trait Expression AST".
 * Build: cc -std=c17 -O2 -Wall -Wextra -Werror trait-harness.c -o trait-harness
 * Run:   ./trait-harness <candidate.dylib|so>
 *
 * Buckets mirror the CTF (Behavior / Update / Scale). Every negative assertion
 * is paired with a positive precondition so the do-nothing starter cannot score.
 */
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct ExprAuditView {
  int exists, kind, string_evaluable, match_evaluable, constant_expr,
      namespace_error, matched, output_string_id;
} ExprAuditView;

typedef void (*f_reset)(void);
typedef int (*f_reg_str)(int, const char *);
typedef int (*f_reg_var)(int, int, int);
typedef int (*f_lit)(int, int);
typedef int (*f_var)(int, int);
typedef int (*f_email)(int, int);
typedef int (*f_repl)(int, int, int, int);
typedef int (*f_match)(int, int, int, int);
typedef int (*f_evstr)(int, int *);
typedef int (*f_evmatch)(int, int);
typedef int (*f_audit)(int, int, ExprAuditView *);
typedef int (*f_err)(void);

static f_reset E_reset; static f_reg_str E_str; static f_reg_var E_var;
static f_lit E_lit; static f_var E_cvar; static f_email E_email;
static f_repl E_repl; static f_match E_match; static f_evstr E_evstr;
static f_evmatch E_evmatch; static f_audit E_audit; static f_err E_err;

static int passes = 0, failures = 0;
static void check(int ok, const char *b, const char *n) {
  printf("%s|%s|%s\n", ok ? "PASS" : "FAIL", b, n);
  fflush(stdout);
  if (ok) passes++; else failures++;
}
static double sec(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)t.tv_sec + (double)t.tv_nsec / 1e9;
}
static void *req(void *l, const char *n) {
  void *s = dlsym(l, n);
  if (!s) { printf("FAIL|Load|missing symbol %s\n", n); exit(2); }
  return s;
}

enum { NS_VALID = 1, NS_BAD = 99 };

/* strings 1..: 1="alice@example.com" 2="alice" 3="a" 4="X" */
static void base(void) {
  E_reset();
  E_str(1, "alice@example.com");
  E_str(2, "alice");
  E_str(3, "a");
  E_str(4, "X");

}

/* ===================== Behavior ===================== */

static void b_literal_roundtrip(void) {
  base();
  E_lit(10, 1);
  int out = -1;
  int rc = E_evstr(10, &out);
  check(rc == 1 && out == 1, "Behavior", "literal evaluates to its string id");
}

static void b_email_local(void) {
  base();
  E_lit(10, 1);            /* alice@example.com */
  E_email(11, 10);
  int out = -1;
  int rc = E_evstr(11, &out);
  /* interning: result must equal the id already registered for "alice" */
  check(rc == 1 && out == 2, "Behavior", "email.local extracts local part and interns to existing id");
}

static void b_email_local_no_at(void) {
  base();
  E_lit(10, 2);            /* "alice" - no @ */
  E_email(11, 10);
  int out = -1;
  int rc = E_evstr(11, &out);
  check(rc == 1 && out == 2, "Behavior", "email.local is identity when no @ present");
}

static void b_var_valid_namespace(void) {
  base();
  E_var(5, NS_VALID, 1);
  E_cvar(10, 5);
  int out = -1;
  int rc = E_evstr(10, &out);
  check(rc == 1 && out == 1, "Behavior", "variable with valid namespace resolves");
}

static void b_bad_namespace_rejected(void) {
  base();
  E_var(5, NS_VALID, 1);
  E_var(6, NS_BAD, 1);
  E_cvar(10, 5);
  E_cvar(11, 6);
  int a = -1, bres = -1;
  int rc_ok = E_evstr(10, &a);
  int rc_bad = E_evstr(11, &bres);
  check(rc_ok == 1 && rc_bad == 0, "Behavior", "invalid namespace rejected (paired with valid)");
}

static void b_bad_namespace_visible_in_audit(void) {
  base();
  E_var(6, NS_BAD, 1);
  E_cvar(11, 6);
  int o = -1; E_evstr(11, &o);
  ExprAuditView v; memset(&v, 0, sizeof v);
  int rc = E_audit(11, 0, &v);
  check(rc == 1 && v.exists == 1 && v.namespace_error == 1,
        "Behavior", "namespace error visible via audit");
}

static void b_bool_not_string_evaluable(void) {
  base();
  E_lit(10, 1);
  E_match(20, 10, 3, 0);          /* matcher over literal */
  int out = -1;
  int good = E_evstr(10, &out);
  int bad = E_evstr(20, &out);
  check(good == 1 && bad == 0, "Behavior", "boolean node rejected by evaluate_string");
}

static void b_audit_unknown(void) {
  base();
  E_lit(10, 1);
  ExprAuditView v; memset(&v, 0, sizeof v);
  int known = E_audit(10, 0, &v);
  int unknown = E_audit(4242, 0, &v);
  check(known == 1 && unknown == 0, "Behavior", "audit 1 for known / 0 for unknown");
}

static void b_distinct_errors(void) {
  base();
  E_lit(10, 1);
  int dup = E_lit(10, 1);            int e_dup = E_err();
  int unk = E_email(12, 999);        int e_unk = E_err();
  int out = 0;
  int np  = E_evstr(10, NULL);       int e_np  = E_err();
  E_match(20, 10, 3, 0);
  int kind = E_evstr(20, &out);      int e_kind = E_err();
  int ok = dup == 0 && unk == 0 && np == 0 && kind == 0 &&
           e_dup && e_unk && e_np && e_kind &&
           e_dup != e_unk && e_dup != e_np && e_dup != e_kind &&
           e_unk != e_np && e_unk != e_kind && e_np != e_kind;
  check(ok, "Behavior", "duplicate/unknown/null/kind errors are distinct");
}

/* ===================== Update ===================== */

static void u_nested_replace_composition(void) {
  base();
  E_str(5, "example");
  E_str(6, "sample");
  E_lit(10, 1);                    /* alice@example.com */
  E_repl(11, 10, 5, 6);            /* -> alice@sample.com */
  int out = -1;
  int rc = E_evstr(11, &out);
  ExprAuditView v; memset(&v, 0, sizeof v);
  E_audit(11, 0, &v);
  check(rc == 1 && out > 0 && v.output_string_id == out,
        "Update", "regex replace composes and audit exposes output id");
}

static void u_deep_nesting_namespace_propagates(void) {
  base();
  E_var(6, NS_BAD, 1);
  E_cvar(10, 6);
  E_email(11, 10);
  E_repl(12, 11, 3, 4);
  int out = -1;
  int rc = E_evstr(12, &out);
  ExprAuditView v; memset(&v, 0, sizeof v);
  E_audit(12, 0, &v);
  check(rc == 0 && v.namespace_error == 1,
        "Update", "namespace error propagates through email.local + replace");
}

static void u_match_with_child(void) {
  base();
  E_lit(10, 2);                    /* "alice" */
  E_match(20, 10, 3, 0);           /* pattern "a" -> matches */
  E_match(21, 10, 4, 0);           /* pattern "X" -> no match */
  int m1 = E_evmatch(20, 0);
  int m0 = E_evmatch(21, 0);
  check(m1 == 1 && m0 == 0, "Update", "matcher over child expression (hit and miss)");
}

static void u_match_negate(void) {
  base();
  E_lit(10, 2);
  E_match(20, 10, 3, 0);
  E_match(21, 10, 3, 1);           /* same pattern, negated */
  int plain = E_evmatch(20, 0);
  int neg = E_evmatch(21, 0);
  check(plain == 1 && neg == 0, "Update", "negate inverts matcher result");
}

static void u_match_without_child_uses_arg(void) {
  base();
  E_match(20, 0, 3, 0);            /* no child -> use matcher_string_id */
  int hit = E_evmatch(20, 2);      /* "alice" contains "a" */
  int miss = E_evmatch(20, 4);     /* "X" does not */
  check(hit == 1 && miss == 0, "Update", "childless matcher uses caller string");
}

static void u_audit_matched_flag(void) {
  base();
  E_lit(10, 2);
  E_match(20, 10, 3, 0);
  E_evmatch(20, 0);
  ExprAuditView v; memset(&v, 0, sizeof v);
  int rc = E_audit(20, 0, &v);
  check(rc == 1 && v.match_evaluable == 1 && v.matched == 1,
        "Update", "audit preserves last matcher result");
}

/* ===================== Scale ===================== */

static int live(void) { int o = -1; return E_evstr(10, &o) == 1; }

static double deep_chain(int depth) {
  base();
  E_str(5, "example");
  E_str(6, "sample");
  E_lit(10, 1);
  int prev = 10;
  for (int i = 0; i < depth; ++i) {
    int id = 100 + i;
    E_repl(id, prev, 5, 6);
    prev = id;
  }
  int out = -1;
  double t0 = sec();
  int rc = E_evstr(prev, &out);
  double t1 = sec();
  if (rc != 1) return -1.0;
  return t1 - t0;
}

static void s_deep_nesting(void) {
  double a = deep_chain(200);
  double b = deep_chain(800);
  if (a < 0 || b < 0) { check(0, "Scale", "deep nesting (evaluation failed - cannot grade)"); return; }
  double ratio = b / (a > 1e-9 ? a : 1e-9);
  printf("INFO|Scale|nesting depth 200 %.5fs  depth 800 %.5fs  ratio %.2fx (4x depth)\n", a, b, ratio);
  check(ratio < 12.0, "Scale", "deep nested evaluation scales sub-quadratically");
}

static double hot_eval(int noise, int reps) {
  base();
  E_lit(10, 1);
  for (int i = 0; i < noise; ++i) {
    char buf[32];
    snprintf(buf, sizeof buf, "noise-%d", i);
    E_str(1000 + i, buf);
    E_lit(20000 + i, 1000 + i);
  }
  if (!live()) return -1.0;
  int out = -1;
  double t0 = sec();
  for (int r = 0; r < reps; ++r) E_evstr(10, &out);
  return sec() - t0;
}

static void s_irrelevant_population(void) {
  double small = hot_eval(1000, 20000);
  double big = hot_eval(16000, 20000);
  if (small < 0 || big < 0) { check(0, "Scale", "hot eval (not live - cannot grade)"); return; }
  double ratio = big / (small > 1e-9 ? small : 1e-9);
  printf("INFO|Scale|hot eval: 1k noise %.5fs  16k noise %.5fs  ratio %.2fx (16x population)\n", small, big, ratio);
  check(ratio < 2.5, "Scale", "hot evaluation independent of irrelevant registrations");
}

static void s_interning_consistency(void) {
  base();
  E_lit(10, 1);
  E_email(11, 10);
  int first = -1, again = -1;
  E_evstr(11, &first);
  E_email(12, 10);
  E_evstr(12, &again);
  printf("INFO|Scale|interning: %d vs %d\n", first, again);
  check(first > 0 && first == again, "Scale", "identical computed strings intern to the same id");
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s <library>\n", argv[0]); return 2; }
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
  if (!lib) { printf("FAIL|Load|dlopen: %s\n", dlerror()); return 2; }
  E_reset   = (f_reset)req(lib, "expr_reset");
  E_str     = (f_reg_str)req(lib, "expr_register_string");
  E_var     = (f_reg_var)req(lib, "expr_register_var");
  E_lit     = (f_lit)req(lib, "expr_compile_literal");
  E_cvar    = (f_var)req(lib, "expr_compile_var");
  E_email   = (f_email)req(lib, "expr_compile_email_local");
  E_repl    = (f_repl)req(lib, "expr_compile_regex_replace");
  E_match   = (f_match)req(lib, "expr_compile_regex_match");
  E_evstr   = (f_evstr)req(lib, "expr_evaluate_string");
  E_evmatch = (f_evmatch)req(lib, "expr_evaluate_match");
  E_audit   = (f_audit)req(lib, "expr_audit_get");
  E_err     = (f_err)req(lib, "expr_last_error");

  b_literal_roundtrip();
  b_email_local();
  b_email_local_no_at();
  b_var_valid_namespace();
  b_bad_namespace_rejected();
  b_bad_namespace_visible_in_audit();
  b_bool_not_string_evaluable();
  b_audit_unknown();
  b_distinct_errors();

  u_nested_replace_composition();
  u_deep_nesting_namespace_propagates();
  u_match_with_child();
  u_match_negate();
  u_match_without_child_uses_arg();
  u_audit_matched_flag();

  s_deep_nesting();
  s_irrelevant_population();
  s_interning_consistency();

  printf("SUMMARY|%d passed|%d failed\n", passes, failures);
  return failures ? 1 : 0;
}

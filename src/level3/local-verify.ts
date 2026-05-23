import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { runGeneratedLevel3Verifier } from "./dynamic-verifier.js";
import { compileLevel3Source, type LocalCompileResult } from "./local-compile.js";
import type { Level3Challenge } from "./types.js";

const execFileAsync = promisify(execFile);

const AUTH_RESOLVER_CHECK_NAMES = [
  "local grant creation succeeds",
  "local basic grant authorizes matching permission",
  "admin permission is independent",
  "time window expiry is exclusive",
  "effective mask returns usable stored mask",
  "audit exposes usable local grant",
  "duplicate ids are rejected",
  "successful mutation clears previous error",
  "bundle import requiring key succeeds",
  "bundle key gate denies before attach",
  "audit reports missing bundle key",
  "bundle key attach is idempotent",
  "bundle authorizes after key attach",
  "local source exists for auto test",
  "bundle source exists for auto test",
  "auto ignores local when subject has bundle grant",
  "auto considers selected bundle source",
  "nondelegatable parent rejects child",
  "delegatable parent creates",
  "permission widening is rejected",
  "child start before parent is rejected",
  "child expiry after parent is rejected",
  "bundle parent can delegate before key attach",
  "missing ancestor key disables child",
  "audit separates ancestor disablement",
  "attaching parent key enables child",
  "revoked parent disables child",
  "count local usable grants",
  "auto count follows bundle precedence and key gate",
  "wrong source key attachment fails",
  "successful key attach clears previous error",
  "unknown audit target returns zero",
  "successful audit clears previous error",
  "null audit output reports error",
  "successful check clears previous error",
  "scale ignores irrelevant local population"
];

export interface Level3LocalCheck {
  name: string;
  ok: boolean;
  message?: string;
}

export interface Level3LocalSemanticResult {
  supported: boolean;
  ok: boolean;
  checks: Level3LocalCheck[];
  harnessPath?: string;
  executablePath?: string;
  command?: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface Level3LocalVerificationResult {
  ok: boolean;
  compile: LocalCompileResult;
  semantic?: Level3LocalSemanticResult;
}

export interface Level3VerifyOptions {
  generatedVerifierSource?: string;
  skipSemantic?: boolean;
}

export async function verifyLevel3Source(
  runDir: string,
  label: string,
  challenge: Pick<Level3Challenge, "taskName" | "language">,
  code: string,
  options: Level3VerifyOptions = {}
): Promise<Level3LocalVerificationResult> {
  const absoluteRunDir = path.resolve(runDir);
  await fs.mkdir(absoluteRunDir, { recursive: true });
  const compile = await compileLevel3Source(absoluteRunDir, label, challenge.language, code);
  if (!compile.ok) return { ok: false, compile };
  if (options.skipSemantic) return { ok: true, compile };

  if (options.generatedVerifierSource?.trim()) {
    const semantic = await runGeneratedLevel3Verifier(absoluteRunDir, label, compile, options.generatedVerifierSource);
    if (semantic.checks.length === 0) {
      return {
        ok: true,
        compile,
        semantic: {
          ...semantic,
          supported: false,
          ok: true,
          error: semantic.error
            ? `generated verifier was unusable and skipped: ${semantic.error}`
            : "generated verifier was unusable and skipped because it produced no checks"
        }
      };
    }
    return { ok: semantic.ok, compile, semantic };
  }

  if (challenge.taskName === "Identity Bundle Auth Resolver") {
    const semantic = await runAuthResolverVerifier(absoluteRunDir, label, compile);
    return { ok: semantic.ok, compile, semantic };
  }

  if (challenge.taskName === "16-bit CPU Emulator") {
    const semantic = await runCpuEmulatorVerifier(absoluteRunDir, label, compile);
    return { ok: semantic.ok, compile, semantic };
  }

  return { ok: true, compile };
}

async function runCpuEmulatorVerifier(
  runDir: string,
  label: string,
  compile: LocalCompileResult
): Promise<Level3LocalSemanticResult> {
  if (!compile.binaryPath) {
    return {
      supported: true,
      ok: false,
      checks: [],
      error: "compiled source did not produce a shared library for CPU semantic verification"
    };
  }

  const harnessPath = path.join(runDir, `cpu-emulator-harness-${label}.c`);
  const executablePath = path.join(runDir, `cpu-emulator-harness-${label}`);
  await fs.writeFile(harnessPath, cpuEmulatorHarnessSource(compile.binaryPath));

  const command = [
    "cc",
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    harnessPath,
    "-o",
    executablePath,
    ...(process.platform === "linux" ? ["-ldl"] : [])
  ];

  try {
    await execFileAsync(command[0]!, command.slice(1), { cwd: runDir, timeout: 10_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    return {
      supported: true,
      ok: false,
      checks: [],
      harnessPath,
      executablePath,
      command,
      error: execErrorMessage(error)
    };
  }

  let stdout = "";
  let stderr = "";
  let processError: string | undefined;
  try {
    const result = await execFileAsync(executablePath, [], { cwd: runDir, timeout: 10_000, maxBuffer: 1024 * 1024 });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = execErrorStdout(error);
    stderr = execErrorStderr(error);
    processError = execErrorMessage(error);
  }

  const checks = parseHarnessChecks(stdout);
  if (processError && checks.every((check) => check.ok)) {
    checks.push({
      ok: false,
      name: "local CPU harness completed all checks",
      message: processError
    });
  }

  return {
    supported: true,
    ok: checks.length > 0 && checks.every((check) => check.ok) && !processError,
    checks,
    harnessPath,
    executablePath,
    command,
    stdout,
    stderr,
    error: processError
  };
}

async function runAuthResolverVerifier(
  runDir: string,
  label: string,
  compile: LocalCompileResult
): Promise<Level3LocalSemanticResult> {
  if (!compile.binaryPath) {
    return {
      supported: true,
      ok: false,
      checks: [],
      error: "compiled source did not produce a shared library for semantic verification"
    };
  }

  const harnessPath = path.join(runDir, `auth-resolver-harness-${label}.c`);
  const executablePath = path.join(runDir, `auth-resolver-harness-${label}`);
  await fs.writeFile(harnessPath, authResolverHarnessSource(compile.binaryPath));

  const command = [
    "cc",
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    harnessPath,
    "-o",
    executablePath,
    ...(process.platform === "linux" ? ["-ldl"] : [])
  ];

  try {
    await execFileAsync(command[0]!, command.slice(1), { cwd: runDir, timeout: 10_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    return {
      supported: true,
      ok: false,
      checks: [],
      harnessPath,
      executablePath,
      command,
      error: execErrorMessage(error)
    };
  }

  let stdout = "";
  let stderr = "";
  let processError: string | undefined;
  try {
    const result = await execFileAsync(executablePath, [], { cwd: runDir, timeout: 10_000, maxBuffer: 1024 * 1024 });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = execErrorStdout(error);
    stderr = execErrorStderr(error);
    processError = execErrorMessage(error);
  }

  const checks = parseHarnessChecks(stdout);
  if (processError && checks.every((check) => check.ok)) {
    checks.push({
      ok: false,
      name: "semantic harness completed all checks",
      message: `harness stopped after ${checks.length}/${AUTH_RESOLVER_CHECK_NAMES.length} checks; next expected check: ${
        AUTH_RESOLVER_CHECK_NAMES[checks.length] ?? "process exit"
      }; ${processError}`
    });
  }
  return {
    supported: true,
    ok: checks.length > 0 && checks.every((check) => check.ok) && !processError,
    checks,
    harnessPath,
    executablePath,
    command,
    stdout,
    stderr,
    error: processError
  };
}

export function parseHarnessChecks(stdout: string): Level3LocalCheck[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [status, name, message] = line.split("|", 3);
      if (status !== "PASS" && status !== "FAIL") return [];
      return [{ ok: status === "PASS", name: name ?? "unnamed check", message }];
    });
}

function execErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.slice(0, 8000);
  }
  if (error && typeof error === "object") {
    const details = [];
    if ("signal" in error && error.signal) details.push(`signal=${String(error.signal)}`);
    if ("killed" in error && error.killed) details.push("killed=true");
    if ("code" in error && error.code !== undefined) details.push(`code=${String(error.code)}`);
    if (details.length > 0) {
      const base = error instanceof Error ? error.message : "process failed";
      return `${base} (${details.join(", ")})`.slice(0, 8000);
    }
  }
  return error instanceof Error ? error.message.slice(0, 8000) : String(error).slice(0, 8000);
}

function execErrorStdout(error: unknown): string {
  return error && typeof error === "object" && "stdout" in error
    ? String((error as { stdout?: unknown }).stdout ?? "")
    : "";
}

function execErrorStderr(error: unknown): string {
  return error && typeof error === "object" && "stderr" in error
    ? String((error as { stderr?: unknown }).stderr ?? "")
    : "";
}

function authResolverHarnessSource(binaryPath: string): string {
  return `
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

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

typedef void (*auth_reset_fn)(void);
typedef int (*auth_create_local_grant_fn)(int, int, int, int, int64_t, int64_t, int);
typedef int (*auth_import_bundle_grant_fn)(int, int, int, int, int64_t, int64_t, int, int);
typedef int (*auth_attach_bundle_key_fn)(int);
typedef int (*auth_delegate_fn)(int, int, int, int, int, int64_t, int64_t, int, int);
typedef int (*auth_revoke_fn)(int);
typedef int (*auth_check_fn)(int, int, int, int64_t, int);
typedef int (*auth_effective_mask_fn)(int, int64_t);
typedef int (*auth_audit_get_fn)(int, int64_t, AuthAuditView *);
typedef int (*auth_count_usable_fn)(int, int64_t, int);
typedef int (*auth_last_error_fn)(void);

static int failures = 0;

static double cpu_seconds(void) {
  return (double)clock() / (double)CLOCKS_PER_SEC;
}

static void record_check(int ok, const char *name, const char *message) {
  if (ok) {
    printf("PASS|%s\\n", name);
  } else {
    printf("FAIL|%s|%s\\n", name, message);
    failures += 1;
  }
  fflush(stdout);
}

#define CHECK(name, expr, message) record_check((expr) ? 1 : 0, name, message)

int main(void) {
  void *lib = dlopen(${JSON.stringify(binaryPath)}, RTLD_NOW | RTLD_LOCAL);
  if (!lib) {
    fprintf(stderr, "dlopen failed: %s\\n", dlerror());
    return 97;
  }

  auth_reset_fn auth_reset = (auth_reset_fn)dlsym(lib, "auth_reset");
  auth_create_local_grant_fn auth_create_local_grant = (auth_create_local_grant_fn)dlsym(lib, "auth_create_local_grant");
  auth_import_bundle_grant_fn auth_import_bundle_grant = (auth_import_bundle_grant_fn)dlsym(lib, "auth_import_bundle_grant");
  auth_attach_bundle_key_fn auth_attach_bundle_key = (auth_attach_bundle_key_fn)dlsym(lib, "auth_attach_bundle_key");
  auth_delegate_fn auth_delegate = (auth_delegate_fn)dlsym(lib, "auth_delegate");
  auth_revoke_fn auth_revoke = (auth_revoke_fn)dlsym(lib, "auth_revoke");
  auth_check_fn auth_check = (auth_check_fn)dlsym(lib, "auth_check");
  auth_effective_mask_fn auth_effective_mask = (auth_effective_mask_fn)dlsym(lib, "auth_effective_mask");
  auth_audit_get_fn auth_audit_get = (auth_audit_get_fn)dlsym(lib, "auth_audit_get");
  auth_count_usable_fn auth_count_usable = (auth_count_usable_fn)dlsym(lib, "auth_count_usable");
  auth_last_error_fn auth_last_error = (auth_last_error_fn)dlsym(lib, "auth_last_error");

  if (!auth_reset || !auth_create_local_grant || !auth_import_bundle_grant || !auth_attach_bundle_key ||
      !auth_delegate || !auth_revoke || !auth_check || !auth_effective_mask || !auth_audit_get ||
      !auth_count_usable || !auth_last_error) {
    fprintf(stderr, "missing exported auth resolver symbol\\n");
    return 98;
  }

  AuthAuditView view;

  auth_reset();
  CHECK("local grant creation succeeds", auth_create_local_grant(1, 10, 20, 3, 100, 200, 1) == 1, "local root grant should be created");
  CHECK("local basic grant authorizes matching permission", auth_check(10, 20, 1, 100, 1) == 1, "READ should authorize at inclusive not_before");
  CHECK("admin permission is independent", auth_check(10, 20, 4, 150, 1) == 0, "ADMIN must not be implied by READ|WRITE");
  CHECK("time window expiry is exclusive", auth_check(10, 20, 1, 200, 1) == 0, "expires_ts is exclusive");
  CHECK("effective mask returns usable stored mask", auth_effective_mask(1, 150) == 3, "usable root effective mask should match stored mask");
  view = (AuthAuditView){0};
  CHECK("audit exposes usable local grant", auth_audit_get(1, 150, &view) == 1 && view.exists == 1 && view.source == 1 && view.stored_mask == 3 && view.effective_mask == 3 && view.key_attached == 1 && view.usable == 1, "local audit fields should be populated");
  CHECK("duplicate ids are rejected", auth_create_local_grant(1, 10, 20, 1, 100, 200, 0) == 0 && auth_last_error() != 0, "duplicate grant id should fail with a nonzero error");
  CHECK("successful mutation clears previous error", auth_create_local_grant(99, 10, 20, 1, 100, 200, 0) == 1 && auth_last_error() == 0, "successful mutation should set last_error to success");

  auth_reset();
  CHECK("bundle import requiring key succeeds", auth_import_bundle_grant(2, 10, 20, 1, 100, 200, 1, 1) == 1, "bundle root should import");
  CHECK("bundle key gate denies before attach", auth_check(10, 20, 1, 150, 2) == 0, "missing key should deny bundle authorization");
  view = (AuthAuditView){0};
  CHECK("audit reports missing bundle key", auth_audit_get(2, 150, &view) == 1 && view.requires_key == 1 && view.key_attached == 0 && view.usable == 0, "audit should expose key gate");
  CHECK("bundle key attach is idempotent", auth_attach_bundle_key(2) == 1 && auth_attach_bundle_key(2) == 1, "attaching an existing bundle key twice should succeed");
  CHECK("bundle authorizes after key attach", auth_check(10, 20, 1, 150, 2) == 1, "attached key should activate bundle grant");

  auth_reset();
  CHECK("local source exists for auto test", auth_create_local_grant(3, 50, 60, 1, 0, 1000, 1) == 1, "local grant should create");
  CHECK("bundle source exists for auto test", auth_import_bundle_grant(4, 50, 60, 2, 0, 1000, 1, 0) == 1, "bundle grant should create");
  CHECK("auto ignores local when subject has bundle grant", auth_check(50, 60, 1, 10, 3) == 0, "AUTO must choose bundle only, not merge local");
  CHECK("auto considers selected bundle source", auth_check(50, 60, 2, 10, 3) == 1, "AUTO should authorize bundle permission");

  auth_reset();
  CHECK("nondelegatable parent rejects child", auth_create_local_grant(5, 1, 70, 1, 10, 50, 0) == 1 && auth_delegate(5, 6, 2, 70, 1, 10, 50, 0, 0) == 0 && auth_last_error() != 0, "nondelegatable parent must reject delegation");
  auth_reset();
  CHECK("delegatable parent creates", auth_create_local_grant(7, 1, 70, 3, 10, 50, 1) == 1, "parent should create");
  CHECK("permission widening is rejected", auth_delegate(7, 8, 2, 70, 4, 10, 50, 0, 0) == 0 && auth_last_error() != 0, "child cannot widen permissions");
  CHECK("child start before parent is rejected", auth_delegate(7, 9, 2, 70, 1, 9, 50, 0, 0) == 0 && auth_last_error() != 0, "child cannot start before parent");
  CHECK("child expiry after parent is rejected", auth_delegate(7, 10, 2, 70, 1, 10, 51, 0, 0) == 0 && auth_last_error() != 0, "child cannot expire after parent");

  auth_reset();
  CHECK("bundle parent can delegate before key attach", auth_import_bundle_grant(11, 1, 80, 3, 100, 200, 1, 1) == 1 && auth_delegate(11, 12, 2, 80, 1, 120, 180, 0, 0) == 1, "delegation should not require parent key material at creation time");
  CHECK("missing ancestor key disables child", auth_check(2, 80, 1, 130, 2) == 0, "ancestor key gate should propagate");
  view = (AuthAuditView){0};
  CHECK("audit separates ancestor disablement", auth_audit_get(12, 130, &view) == 1 && view.disabled_by_ancestor == 1 && view.revoked == 0 && view.usable == 0, "child audit should show ancestor disablement");
  CHECK("attaching parent key enables child", auth_attach_bundle_key(11) == 1 && auth_check(2, 80, 1, 130, 2) == 1, "attached parent key should enable descendant");
  CHECK("revoked parent disables child", auth_revoke(11) == 1 && auth_check(2, 80, 1, 130, 2) == 0, "parent revocation should disable descendant");

  auth_reset();
  CHECK("count local usable grants", auth_create_local_grant(20, 90, 1, 1, 0, 100, 0) == 1 && auth_create_local_grant(21, 90, 2, 2, 200, 300, 0) == 1 && auth_count_usable(90, 50, 1) == 1, "LOCAL_ONLY count should ignore future grant");
  CHECK("auto count follows bundle precedence and key gate", auth_import_bundle_grant(22, 90, 3, 1, 0, 100, 0, 1) == 1 && auth_count_usable(90, 50, 3) == 0 && auth_attach_bundle_key(22) == 1 && auth_count_usable(90, 50, 3) == 1, "AUTO count should consider bundle source only");

  CHECK("wrong source key attachment fails", auth_attach_bundle_key(20) == 0 && auth_last_error() != 0, "local grants cannot accept bundle keys");
  CHECK("successful key attach clears previous error", auth_import_bundle_grant(23, 90, 4, 1, 0, 100, 0, 1) == 1 && auth_attach_bundle_key(23) == 1 && auth_last_error() == 0, "successful key attach should clear prior error");
  CHECK("unknown audit target returns zero", auth_audit_get(9999, 0, &view) == 0 && auth_last_error() != 0, "unknown audit target should fail");
  CHECK("successful audit clears previous error", auth_audit_get(20, 50, &view) == 1 && auth_last_error() == 0, "successful audit should clear prior error");
  CHECK("null audit output reports error", auth_audit_get(20, 0, NULL) == 0 && auth_last_error() != 0, "null audit output must fail");
  CHECK("successful check clears previous error", auth_check(90, 1, 1, 50, 1) == 1 && auth_last_error() == 0, "successful check should clear prior error");

  auth_reset();
  for (int i = 0; i < 50000; i += 1) {
    if (auth_create_local_grant(100000 + i, 100000 + i, 7000 + i, 1, 0, 1000000, 0) != 1) {
      printf("FAIL|scale ignores irrelevant local population|failed to create irrelevant grant %d\\n", i);
      fflush(stdout);
      failures += 1;
      break;
    }
  }
  int scale_setup_ok = auth_create_local_grant(900001, 4242, 5151, 1, 0, 1000000, 0) == 1;
  double scale_start = cpu_seconds();
  int scale_ok = scale_setup_ok;
  for (int i = 0; i < 2000; i += 1) {
    if (auth_check(4242, 5151, 1, 123, 1) != 1 || auth_count_usable(4242, 123, 1) != 1) {
      scale_ok = 0;
      break;
    }
  }
  double scale_elapsed = cpu_seconds() - scale_start;
  char scale_message[160];
  snprintf(scale_message, sizeof(scale_message), "queries over irrelevant population should stay indexed; elapsed_cpu_seconds=%.3f", scale_elapsed);
  CHECK("scale ignores irrelevant local population", scale_ok && scale_elapsed < 2.0, scale_message);

  dlclose(lib);
  return failures == 0 ? 0 : 1;
}
`;
}

function cpuEmulatorHarnessSource(binaryPath: string): string {
  return `
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef void (*cpu_reset_fn)(void);
typedef void (*cpu_load_word_fn)(int, int);
typedef int (*cpu_assemble_fn)(const char *, int, uint16_t *, int);
typedef void (*cpu_set_reg_fn)(int, int);
typedef int (*cpu_get_reg_fn)(int);
typedef int (*cpu_get_pc_fn)(void);
typedef int (*cpu_get_sp_fn)(void);
typedef int (*cpu_get_flag_fn)(void);
typedef int (*cpu_mem_read16_fn)(int);
typedef int (*cpu_run_fn)(int);

static cpu_reset_fn cpu_reset_p;
static cpu_load_word_fn cpu_load_word_p;
static cpu_assemble_fn cpu_assemble_p;
static cpu_set_reg_fn cpu_set_reg_p;
static cpu_get_reg_fn cpu_get_reg_p;
static cpu_get_pc_fn cpu_get_pc_p;
static cpu_get_sp_fn cpu_get_sp_p;
static cpu_get_flag_fn cpu_get_flag_z_p;
static cpu_get_flag_fn cpu_get_flag_n_p;
static cpu_get_flag_fn cpu_get_flag_v_p;
static cpu_mem_read16_fn cpu_mem_read16_p;
static cpu_run_fn cpu_run_p;
static int failures = 0;

static void check(int ok, const char *name, const char *message) {
  printf("%s|%s|%s\\n", ok ? "PASS" : "FAIL", name, message ? message : "");
  fflush(stdout);
  if (!ok) failures += 1;
}

static double cpu_seconds(void) {
  return (double)clock() / (double)CLOCKS_PER_SEC;
}

static void *required_symbol(void *lib, const char *name) {
  void *sym = dlsym(lib, name);
  if (!sym) {
    check(0, name, dlerror());
    exit(2);
  }
  return sym;
}

static uint16_t enc_rr(int opcode, int rd, int rs) {
  return (uint16_t)(((uint16_t)opcode << 11) | ((uint16_t)rd << 8) | ((uint16_t)rs << 5));
}

static uint16_t enc_ri(int opcode, int rd, int imm5) {
  return (uint16_t)(((uint16_t)opcode << 11) | ((uint16_t)rd << 8) | ((uint16_t)imm5 & 0x1f));
}

static uint16_t enc_load(int rd) {
  return (uint16_t)((0x01u << 11) | ((uint16_t)rd << 8));
}

static uint16_t enc_simple(int opcode) {
  return (uint16_t)((uint16_t)opcode << 11);
}

static void load_words(const uint16_t *words, int count) {
  cpu_reset_p();
  for (int i = 0; i < count; ++i) {
    cpu_load_word_p(i * 2, words[i]);
  }
}

static int assemble(const char *source, uint16_t *out, int max_words) {
  return cpu_assemble_p(source, (int)strlen(source), out, max_words);
}

static int flags_are(int z, int n, int v) {
  return cpu_get_flag_z_p() == z && cpu_get_flag_n_p() == n && cpu_get_flag_v_p() == v;
}

static void load_assembled(const uint16_t *words, int count) {
  cpu_reset_p();
  for (int i = 0; i < count; ++i) {
    cpu_load_word_p(i * 2, words[i]);
  }
}

static void check_reset(void) {
  cpu_reset_p();
  cpu_set_reg_p(3, 123);
  cpu_load_word_p(10, 0xbeef);
  cpu_reset_p();
  check(cpu_get_reg_p(3) == 0 && cpu_get_pc_p() == 0 && cpu_get_sp_p() == 0xffff &&
          cpu_get_flag_z_p() == 0 && cpu_get_flag_n_p() == 0 && cpu_get_flag_v_p() == 0 &&
          cpu_mem_read16_p(10) == 0,
        "local CPU reset state semantics",
        "reset should clear registers, flags, memory, PC and SP");
}

static void check_helper_bounds(void) {
  cpu_reset_p();
  cpu_load_word_p(2, 0xabcd);
  cpu_load_word_p(3, 0x3412);
  cpu_load_word_p(65534, 0xcafe);
  cpu_load_word_p(-1, 0x1111);
  cpu_load_word_p(65535, 0x2222);
  cpu_set_reg_p(2, 0x123456);
  cpu_set_reg_p(-1, 0xffff);
  cpu_set_reg_p(8, 0xffff);
  check(cpu_mem_read16_p(2) == 0x12cd && cpu_mem_read16_p(3) == 0x3412 &&
          cpu_mem_read16_p(65534) == 0xcafe && cpu_mem_read16_p(-1) == 0 &&
          cpu_mem_read16_p(65535) == 0 && cpu_get_reg_p(2) == 0x3456 &&
          cpu_get_reg_p(-1) == 0 && cpu_get_reg_p(8) == 0,
        "local CPU helper load-word + mem-read bounds",
        "public helpers must truncate words/registers and reject out-of-range addresses or registers");
}

static void check_add_overflow_flags(void) {
  const uint16_t overflow_words[] = {enc_load(0), 0x7fff, enc_load(1), 0x0001, enc_rr(0x03, 0, 1), enc_simple(0x16)};
  load_words(overflow_words, (int)(sizeof(overflow_words) / sizeof(overflow_words[0])));
  int ran_overflow = cpu_run_p(16);
  int overflow_ok = ran_overflow == 4 && cpu_get_reg_p(0) == 0x8000 && flags_are(0, 1, 1);

  const uint16_t zero_words[] = {enc_load(0), 0xffff, enc_load(1), 0x0001, enc_rr(0x03, 0, 1), enc_simple(0x16)};
  load_words(zero_words, (int)(sizeof(zero_words) / sizeof(zero_words[0])));
  int ran_zero = cpu_run_p(16);
  int zero_ok = ran_zero == 4 && cpu_get_reg_p(0) == 0 && flags_are(1, 0, 0);

  check(overflow_ok && zero_ok,
        "local CPU ADD overflow flag behavior",
        "ADD must use signed overflow while still wrapping modulo 16 bits and setting Z/N from the wrapped result");
}

static void check_sub_overflow_flags(void) {
  const uint16_t overflow_words[] = {enc_load(0), 0x8000, enc_load(1), 0x0001, enc_rr(0x04, 0, 1), enc_simple(0x16)};
  load_words(overflow_words, (int)(sizeof(overflow_words) / sizeof(overflow_words[0])));
  int ran_overflow = cpu_run_p(16);
  int overflow_ok = ran_overflow == 4 && cpu_get_reg_p(0) == 0x7fff && flags_are(0, 0, 1);

  const uint16_t zero_words[] = {enc_load(0), 0x0001, enc_load(1), 0x0001, enc_rr(0x04, 0, 1), enc_simple(0x16)};
  load_words(zero_words, (int)(sizeof(zero_words) / sizeof(zero_words[0])));
  int ran_zero = cpu_run_p(16);
  int zero_ok = ran_zero == 4 && cpu_get_reg_p(0) == 0 && flags_are(1, 0, 0);

  check(overflow_ok && zero_ok,
        "local CPU SUB overflow flag behavior",
        "SUB must set signed overflow, Z, and N from the wrapped subtraction result");
}

static void check_cmp_flags_only(void) {
  const uint16_t equal_words[] = {enc_load(0), 0x1234, enc_load(1), 0x1234, enc_rr(0x0b, 0, 1), enc_simple(0x16)};
  load_words(equal_words, (int)(sizeof(equal_words) / sizeof(equal_words[0])));
  int ran_equal = cpu_run_p(16);
  int equal_ok = ran_equal == 4 && cpu_get_reg_p(0) == 0x1234 && cpu_get_reg_p(1) == 0x1234 && flags_are(1, 0, 0);

  const uint16_t overflow_words[] = {enc_load(0), 0x8000, enc_load(1), 0x0001, enc_rr(0x0b, 0, 1), enc_simple(0x16)};
  load_words(overflow_words, (int)(sizeof(overflow_words) / sizeof(overflow_words[0])));
  int ran_overflow = cpu_run_p(16);
  int overflow_ok = ran_overflow == 4 && cpu_get_reg_p(0) == 0x8000 && cpu_get_reg_p(1) == 1 && flags_are(0, 0, 1);

  check(equal_ok && overflow_ok,
        "local CPU CMP flag-only behavior",
        "CMP must update flags exactly like SUB without modifying either operand register");
}

static void check_bitwise_and_shift(void) {
  const uint16_t words[] = {
      enc_load(0), 0x7fff, enc_load(1), 0x0001, enc_rr(0x03, 0, 1),
      enc_ri(0x0a, 0, 1), enc_load(2), 0x8000, enc_ri(0x09, 2, 1), enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  int ran = cpu_run_p(32);
  check(ran == 7 && cpu_get_reg_p(0) == 0x4000 && cpu_get_reg_p(2) == 0 &&
          cpu_get_flag_z_p() == 1 &&
          cpu_get_flag_n_p() == 0 && cpu_get_flag_v_p() == 0,
        "local CPU bitwise + shift scalar semantics",
        "ADD must set V, then SHL/SHR must use imm5, update Z/N, and clear V");

  const uint16_t bitwise_words[] = {
      enc_load(0), 0xf0f0, enc_load(1), 0x0ff0, enc_rr(0x05, 0, 1),
      enc_load(2), 0x8001, enc_load(3), 0x0001, enc_rr(0x07, 2, 3),
      enc_load(4), 0xffff, (uint16_t)((0x08u << 11) | (4u << 8)),
      enc_load(5), 0x0001, enc_ri(0x09, 5, 15),
      enc_load(6), 0x8000, enc_ri(0x0a, 6, 15),
      enc_load(7), 0xffff, enc_ri(0x09, 7, 31), enc_simple(0x16)};
  load_words(bitwise_words, (int)(sizeof(bitwise_words) / sizeof(bitwise_words[0])));
  ran = cpu_run_p(64);
  check(ran == 15 && cpu_get_reg_p(0) == 0x00f0 && cpu_get_reg_p(2) == 0x8000 &&
          cpu_get_reg_p(4) == 0 && cpu_get_reg_p(5) == 0x8000 && cpu_get_reg_p(6) == 1 &&
          cpu_get_reg_p(7) == 0x8000 && cpu_get_flag_z_p() == 0 && cpu_get_flag_n_p() == 1 &&
          cpu_get_flag_v_p() == 0,
        "local CPU bitwise + shift edge semantics",
        "AND/XOR/NOT and wide imm5 shifts must mask count to 0..15, update Z/N, and clear V");
}

static void check_branch_control_flow(void) {
  const uint16_t words[] = {
      enc_load(0), 0x0000,
      enc_load(1), 0x0001,
      enc_rr(0x0b, 0, 0),
      (uint16_t)((0x0eu << 11) | 16u),
      enc_rr(0x04, 0, 1),
      (uint16_t)((0x0fu << 11) | 22u),
      enc_load(2), 0xdead,
      enc_simple(0x16),
      enc_load(2), 0xbeef,
      enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  int ran = cpu_run_p(32);
  check(ran == 8 && cpu_get_reg_p(0) == 0xffff && cpu_get_reg_p(2) == 0xbeef &&
          cpu_get_pc_p() == 28 && flags_are(0, 1, 0),
        "local CPU JNZ/JN branch control flow",
        "JNZ must skip when Z is set and JN must branch to a byte-addressed target when N is set");
}

static void check_stack_push_pop(void) {
  const uint16_t words[] = {
      enc_load(0), 0x1234,
      enc_rr(0x12, 0, 0),
      enc_load(0), 0x0000,
      enc_rr(0x13, 1, 0),
      enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  int ran = cpu_run_p(16);
  check(ran == 5 && cpu_get_reg_p(0) == 0 && cpu_get_reg_p(1) == 0x1234 &&
          cpu_get_sp_p() == 0xffff && cpu_mem_read16_p(0xfffd) == 0x1234,
        "local CPU stack push/pop behavior",
        "PUSH must predecrement SP by 2, POP must read then postincrement SP, and stack memory must be little-endian");
}

static void check_call_ret_discipline(void) {
  const uint16_t words[] = {
      enc_simple(0x14), 0x0008,
      enc_simple(0x16),
      enc_simple(0x00),
      enc_load(0), 0x2345,
      enc_simple(0x15)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  int ran = cpu_run_p(16);
  check(ran == 4 && cpu_get_reg_p(0) == 0x2345 && cpu_get_sp_p() == 0xffff && cpu_get_pc_p() == 6,
        "local CPU CALL/RET discipline",
        "CALL must push the post-extension return address and RET must restore PC/SP before the caller HALT");
}

static void check_simd_vadd(void) {
  const uint16_t words[] = {enc_rr(0x17, 0, 4), enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  cpu_set_reg_p(0, 0xffff);
  cpu_set_reg_p(1, 0x0001);
  cpu_set_reg_p(2, 0x8000);
  cpu_set_reg_p(3, 0x1234);
  cpu_set_reg_p(4, 0x0001);
  cpu_set_reg_p(5, 0xffff);
  cpu_set_reg_p(6, 0x8000);
  cpu_set_reg_p(7, 0xedcb);
  int ran = cpu_run_p(8);
  check(ran == 2 && cpu_get_reg_p(0) == 0 && cpu_get_reg_p(1) == 0 &&
          cpu_get_reg_p(2) == 0 && cpu_get_reg_p(3) == 0xffff && flags_are(0, 0, 0),
        "local CPU SIMD VADD lane wraparound",
        "VADD must operate lane-wise over R0..R3/R4..R7 with 16-bit wrapping and no flag changes");
}

static void check_simd_vsub(void) {
  const uint16_t words[] = {enc_rr(0x18, 4, 0), enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  cpu_set_reg_p(0, 0x0001);
  cpu_set_reg_p(1, 0x0002);
  cpu_set_reg_p(2, 0xffff);
  cpu_set_reg_p(3, 0x8000);
  cpu_set_reg_p(4, 0x0000);
  cpu_set_reg_p(5, 0x0001);
  cpu_set_reg_p(6, 0x0001);
  cpu_set_reg_p(7, 0x7fff);
  int ran = cpu_run_p(8);
  check(ran == 2 && cpu_get_reg_p(4) == 0xffff && cpu_get_reg_p(5) == 0xffff &&
          cpu_get_reg_p(6) == 2 && cpu_get_reg_p(7) == 0xffff && flags_are(0, 0, 0),
        "local CPU SIMD VSUB lane wraparound",
        "VSUB must subtract corresponding lanes with 16-bit wrapping and no scalar flag updates");
}

static void check_simd_vxor_flag_stability(void) {
  const uint16_t words[] = {
      enc_load(0), 0x0001,
      enc_load(1), 0x0001,
      enc_rr(0x0b, 0, 1),
      enc_rr(0x19, 4, 4),
      enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  cpu_set_reg_p(4, 0xffff);
  cpu_set_reg_p(5, 0x00ff);
  cpu_set_reg_p(6, 0x0f0f);
  cpu_set_reg_p(7, 0xf0f0);
  int ran = cpu_run_p(16);
  check(ran == 5 && cpu_get_reg_p(4) == 0 && cpu_get_reg_p(5) == 0 &&
          cpu_get_reg_p(6) == 0 && cpu_get_reg_p(7) == 0 && flags_are(1, 0, 0),
        "local CPU SIMD VXOR and flag stability",
        "VXOR must operate on vector lanes without clobbering flags set by a preceding CMP");
}

static void check_assembler_exact_encoding(void) {
  uint16_t words[64];
  const char *src =
      "LOAD R0, #0x1234\\n"
      "MOV R1, R0\\n"
      "ADD R1, R0\\n"
      "SUB R1, R0\\n"
      "AND R1, R0\\n"
      "OR R1, R0\\n"
      "XOR R1, R0\\n"
      "NOT R1\\n"
      "SHL R1, #15\\n"
      "SHR R1, #31\\n"
      "CMP R1, R0\\n"
      "JMP #done\\n"
      "done: HALT\\n";
  const uint16_t expected[] = {
      enc_load(0), 0x1234, enc_rr(0x02, 1, 0), enc_rr(0x03, 1, 0),
      enc_rr(0x04, 1, 0), enc_rr(0x05, 1, 0), enc_rr(0x06, 1, 0),
      enc_rr(0x07, 1, 0), (uint16_t)((0x08u << 11) | (1u << 8)),
      enc_ri(0x09, 1, 15), enc_ri(0x0a, 1, 31), enc_rr(0x0b, 1, 0),
      (uint16_t)((0x0cu << 11) | 26u), enc_simple(0x16)};
  int count = assemble(src, words, 64);
  int ok = count == (int)(sizeof(expected) / sizeof(expected[0]));
  if (ok) {
    for (int i = 0; i < count; ++i) {
      if (words[i] != expected[i]) {
        ok = 0;
        break;
      }
    }
  }
  check(ok, "local CPU assembler program: basic ALU/data path",
        "assembler must emit exact opcode, register, imm5, extension-word, and byte-address label fields");
}

static void check_str_and_branch_memory_program(void) {
  uint16_t words[64];
  const char *src =
      "// store, reload, and branch around the bad path\\n"
      "LOAD R0, #0x0200\\n"
      "LOAD R1, #0x1234\\n"
      "STR R0, R1  // mem[R0] = R1\\n"
      "LDR R2, R0\\n"
      "CMP R2, R1\\n"
      "JNZ #bad\\n"
      "LOAD R3, #0xbeef\\n"
      "HALT\\n"
      "bad: LOAD R3, #0xdead\\n"
      "HALT\\n";
  int count = assemble(src, words, 64);
  if (count <= 0) {
    check(0, "local CPU assembler program: branch+memory", "assembler rejected branch+memory program");
    return;
  }
  load_assembled(words, count);
  int ran = cpu_run_p(64);
  check(ran > 0 && cpu_get_reg_p(2) == 0x1234 && cpu_mem_read16_p(0x0200) == 0x1234 &&
          cpu_get_reg_p(3) == 0xbeef,
        "local CPU assembler program: branch+memory",
        "assembled STR/LDR/CMP/JNZ program produced wrong memory or branch result");
}

static void check_loop_sum_program(void) {
  uint16_t words[64];
  const char *src =
      "// count down and accumulate\\n"
      "LOAD R0, #0\\n"
      "LOAD R1, #5\\n"
      "LOAD R2, #1\\n"
      "loop: ADD R0, R1\\n"
      "SUB R1, R2\\n"
      "JNZ #loop\\n"
      "HALT\\n";
  int count = assemble(src, words, 64);
  if (count <= 0) {
    check(0, "local CPU assembler program: loop/sum", "assembler rejected loop/sum program");
    return;
  }
  load_assembled(words, count);
  int ran = cpu_run_p(64);
  check(ran > 0 && cpu_get_reg_p(0) == 15 && cpu_get_reg_p(1) == 0 && cpu_get_flag_z_p() == 1,
        "local CPU assembler program: loop/sum",
        "assembled loop did not sum 5+4+3+2+1 and stop on Z");
}

static void check_nested_call_program(void) {
  uint16_t words[64];
  const char *src =
      "LOAD R0, #2\\n"
      "CALL #inc\\n"
      "CALL #inc\\n"
      "HALT\\n"
      "inc: LOAD R1, #1\\n"
      "ADD R0, R1\\n"
      "RET\\n";
  int count = assemble(src, words, 64);
  if (count <= 0) {
    check(0, "local CPU assembler program: nested calls", "assembler rejected nested call program");
    return;
  }
  load_assembled(words, count);
  int ran = cpu_run_p(64);
  check(ran > 0 && cpu_get_reg_p(0) == 4 && cpu_get_sp_p() == 0xffff,
        "local CPU assembler program: nested calls",
        "CALL/RET did not preserve return addresses and stack pointer");
}

static void check_invalid_source(void) {
  uint16_t words[8];
  const char *bad_sources[] = {
      "LOAD R8, 1\\n",
      "LOAD R0, 65536\\n",
      "CALL 65536\\n",
      "JMP -1\\n",
      "SHL R0, -1\\n",
      "VADD R1, R4\\n",
      "JMP 4096\\n",
      "dup: NOP\\ndup: NOP\\n",
      "LOAD R0, 1, 2\\n",
      "ADD R0\\n"};
  int ok = 1;
  for (int i = 0; i < (int)(sizeof(bad_sources) / sizeof(bad_sources[0])); ++i) {
    if (assemble(bad_sources[i], words, 8) >= 0) {
      ok = 0;
      break;
    }
  }
  check(ok, "local CPU assembler rejects invalid source", "assembler accepted an invalid source form");
}

static int expected_add_overflow(uint16_t a, uint16_t b, uint16_t result) {
  return (((~(a ^ b)) & (a ^ result) & 0x8000u) != 0);
}

static int expected_sub_overflow(uint16_t a, uint16_t b, uint16_t result) {
  return ((((a ^ b) & (a ^ result)) & 0x8000u) != 0);
}

static void check_randomized_alu_cmp_properties(void) {
  const uint16_t cases[][2] = {
      {0x0000, 0x0000}, {0x0001, 0x0001}, {0x7fff, 0x0001},
      {0x8000, 0x0001}, {0xffff, 0x0001}, {0x1234, 0xedcb},
      {0x8000, 0x8000}, {0x4000, 0x4000}};
  int ok = 1;
  for (int i = 0; i < (int)(sizeof(cases) / sizeof(cases[0])); ++i) {
    uint16_t a = cases[i][0];
    uint16_t b = cases[i][1];
    uint16_t add_result = (uint16_t)(a + b);
    const uint16_t add_words[] = {enc_load(0), a, enc_load(1), b, enc_rr(0x03, 0, 1), enc_simple(0x16)};
    load_words(add_words, (int)(sizeof(add_words) / sizeof(add_words[0])));
    ok = ok && cpu_run_p(16) == 4 && cpu_get_reg_p(0) == add_result &&
        flags_are(add_result == 0, (add_result & 0x8000u) != 0, expected_add_overflow(a, b, add_result));

    uint16_t sub_result = (uint16_t)(a - b);
    const uint16_t sub_words[] = {enc_load(0), a, enc_load(1), b, enc_rr(0x04, 0, 1), enc_simple(0x16)};
    load_words(sub_words, (int)(sizeof(sub_words) / sizeof(sub_words[0])));
    ok = ok && cpu_run_p(16) == 4 && cpu_get_reg_p(0) == sub_result &&
        flags_are(sub_result == 0, (sub_result & 0x8000u) != 0, expected_sub_overflow(a, b, sub_result));

    const uint16_t cmp_words[] = {enc_load(0), a, enc_load(1), b, enc_rr(0x0b, 0, 1), enc_simple(0x16)};
    load_words(cmp_words, (int)(sizeof(cmp_words) / sizeof(cmp_words[0])));
    ok = ok && cpu_run_p(16) == 4 && cpu_get_reg_p(0) == a && cpu_get_reg_p(1) == b &&
        flags_are(sub_result == 0, (sub_result & 0x8000u) != 0, expected_sub_overflow(a, b, sub_result));
  }
  check(ok,
        "local CPU randomized ALU + CMP flag property checks",
        "ADD/SUB/CMP flags must match signed-overflow formulas across representative 16-bit edge cases");
}

static void check_cycle_budget_constraints(void) {
  const uint16_t words[] = {enc_simple(0x00), enc_simple(0x00), enc_simple(0x16)};
  load_words(words, (int)(sizeof(words) / sizeof(words[0])));
  int first = cpu_run_p(2);
  int pc_after_first = cpu_get_pc_p();
  int second = cpu_run_p(2);
  int pc_after_second = cpu_get_pc_p();
  int third = cpu_run_p(2);
  check(first == 2 && pc_after_first == 4 && second == 1 && pc_after_second == 6 && third == 0,
        "local CPU cycle/timing budget constraints",
        "cpu_run must honor max_cycles, return executed instruction count, and execute nothing after HALT");
}

static void check_run_throughput(void) {
  enum { NOPS = 3000 };
  cpu_reset_p();
  for (int i = 0; i < NOPS; ++i) {
    cpu_load_word_p(i * 2, enc_simple(0x00));
  }
  cpu_load_word_p(NOPS * 2, enc_simple(0x16));
  double start = cpu_seconds();
  int ran = cpu_run_p(NOPS + 8);
  double elapsed = cpu_seconds() - start;
  char message[160];
  snprintf(message, sizeof(message), "expected linear execution of %d NOPs plus HALT; elapsed_cpu_seconds=%.3f", NOPS, elapsed);
  check(ran == NOPS + 1 && elapsed < 2.0,
        "local CPU run throughput benchmark",
        message);
}

static void check_simd_throughput(void) {
  enum { OPS = 2000 };
  cpu_reset_p();
  for (int i = 0; i < OPS; ++i) {
    cpu_load_word_p(i * 2, enc_rr(0x17, 0, 4));
  }
  cpu_load_word_p(OPS * 2, enc_simple(0x16));
  cpu_set_reg_p(0, 1);
  cpu_set_reg_p(1, 2);
  cpu_set_reg_p(2, 3);
  cpu_set_reg_p(3, 4);
  cpu_set_reg_p(4, 0);
  cpu_set_reg_p(5, 0);
  cpu_set_reg_p(6, 0);
  cpu_set_reg_p(7, 0);
  double start = cpu_seconds();
  int ran = cpu_run_p(OPS + 8);
  double elapsed = cpu_seconds() - start;
  char message[160];
  snprintf(message, sizeof(message), "expected linear SIMD execution for %d vector ops; elapsed_cpu_seconds=%.3f", OPS, elapsed);
  check(ran == OPS + 1 && cpu_get_reg_p(0) == 1 && cpu_get_reg_p(3) == 4 && elapsed < 2.0,
        "local CPU SIMD throughput benchmark",
        message);
}

static void check_large_label_sets(void) {
  enum { PREFIX_LABELS = 500, TAIL_LABELS = 700, CAP = 120000 };
  char *program = (char *)malloc(CAP);
  uint16_t *words = (uint16_t *)calloc((size_t)PREFIX_LABELS + TAIL_LABELS + 8u, sizeof(uint16_t));
  if (!program || !words) {
    check(0, "local CPU assembler handles large label sets", "failed to allocate local assembler stress buffers");
    free(program);
    free(words);
    return;
  }

  int len = 0;
  len += snprintf(program + len, CAP - len, "JMP #target\\n");
  for (int i = 0; i < PREFIX_LABELS; ++i) {
    len += snprintf(program + len, CAP - len, "label_%04d: NOP\\n", i);
  }
  len += snprintf(program + len, CAP - len, "target: HALT\\n");
  for (int i = 0; i < TAIL_LABELS; ++i) {
    len += snprintf(program + len, CAP - len, "tail_%04d: NOP\\n", i);
  }

  int count = assemble(program, words, PREFIX_LABELS + TAIL_LABELS + 8);
  int ok = count == PREFIX_LABELS + TAIL_LABELS + 2 &&
      words[0] == (uint16_t)((0x0cu << 11) | ((PREFIX_LABELS + 1) * 2));
  check(ok,
        "local CPU assembler handles large label sets",
        "assembler must resolve many labels and forward references without corrupting byte-addressed targets");
  free(program);
  free(words);
}

static void check_assembler_label_lookup_benchmark(void) {
  enum { LABELS = 900, CAP = 90000 };
  char *program = (char *)malloc(CAP);
  uint16_t *words = (uint16_t *)calloc((size_t)LABELS + 4u, sizeof(uint16_t));
  if (!program || !words) {
    check(0, "local CPU assembler label lookup benchmark", "failed to allocate label benchmark buffers");
    free(program);
    free(words);
    return;
  }
  int len = 0;
  len += snprintf(program + len, CAP - len, "JMP #target\\n");
  for (int i = 0; i < LABELS; ++i) {
    len += snprintf(program + len, CAP - len, "bench_%04d: NOP\\n", i);
  }
  len += snprintf(program + len, CAP - len, "target: HALT\\n");
  double start = cpu_seconds();
  int count = assemble(program, words, LABELS + 4);
  double elapsed = cpu_seconds() - start;
  char message[160];
  snprintf(message, sizeof(message), "resolved %d labels in %.3f CPU seconds", LABELS, elapsed);
  check(count == LABELS + 2 && elapsed < 2.0,
        "local CPU assembler label lookup benchmark",
        message);
  free(program);
  free(words);
}

static void check_assembler_mnemonic_decode_benchmark(void) {
  enum { REPS = 250, CAP = 80000, MAX_WORDS = 4000 };
  char *program = (char *)malloc(CAP);
  uint16_t *words = (uint16_t *)calloc(MAX_WORDS, sizeof(uint16_t));
  if (!program || !words) {
    check(0, "local CPU assembler mnemonic decode benchmark", "failed to allocate mnemonic benchmark buffers");
    free(program);
    free(words);
    return;
  }
  int len = 0;
  for (int i = 0; i < REPS; ++i) {
    len += snprintf(program + len, CAP - len,
                    "ADD R0, R1\\nSUB R0, R1\\nAND R0, R1\\nOR R0, R1\\nXOR R0, R1\\nNOT R0\\nSHL R0, #1\\nSHR R0, #1\\nCMP R0, R1\\n");
  }
  len += snprintf(program + len, CAP - len, "HALT\\n");
  double start = cpu_seconds();
  int count = assemble(program, words, MAX_WORDS);
  double elapsed = cpu_seconds() - start;
  char message[160];
  snprintf(message, sizeof(message), "decoded %d mnemonic lines in %.3f CPU seconds", REPS * 9 + 1, elapsed);
  check(count == REPS * 9 + 1 && elapsed < 2.0,
        "local CPU assembler mnemonic decode benchmark",
        message);
  free(program);
  free(words);
}

static void check_wraparound_fetch(void) {
  const uint16_t setup[] = {enc_load(0), 0xffff, enc_load(1), enc_simple(0x16), enc_rr(0x11, 0, 1), enc_simple(0x14), 0xffff};
  load_words(setup, (int)(sizeof(setup) / sizeof(setup[0])));
  int ran = cpu_run_p(16);
  check(ran == 5 && cpu_get_pc_p() == 1,
        "local CPU core wraparound + unaligned semantics",
        "CALL to 0xffff should fetch HALT across the 0xffff to 0x0000 boundary");
}

int main(void) {
  void *lib = dlopen(${JSON.stringify(binaryPath)}, RTLD_NOW);
  if (!lib) {
    check(0, "load CPU shared library", dlerror());
    return 1;
  }

  cpu_reset_p = (cpu_reset_fn)required_symbol(lib, "cpu_reset");
  cpu_load_word_p = (cpu_load_word_fn)required_symbol(lib, "cpu_load_word");
  cpu_assemble_p = (cpu_assemble_fn)required_symbol(lib, "cpu_assemble");
  cpu_set_reg_p = (cpu_set_reg_fn)required_symbol(lib, "cpu_set_reg");
  cpu_get_reg_p = (cpu_get_reg_fn)required_symbol(lib, "cpu_get_reg");
  cpu_get_pc_p = (cpu_get_pc_fn)required_symbol(lib, "cpu_get_pc");
  cpu_get_sp_p = (cpu_get_sp_fn)required_symbol(lib, "cpu_get_sp");
  cpu_get_flag_z_p = (cpu_get_flag_fn)required_symbol(lib, "cpu_get_flag_z");
  cpu_get_flag_n_p = (cpu_get_flag_fn)required_symbol(lib, "cpu_get_flag_n");
  cpu_get_flag_v_p = (cpu_get_flag_fn)required_symbol(lib, "cpu_get_flag_v");
  cpu_mem_read16_p = (cpu_mem_read16_fn)required_symbol(lib, "cpu_mem_read16");
  cpu_run_p = (cpu_run_fn)required_symbol(lib, "cpu_run");

  check_reset();
  check_helper_bounds();
  check_add_overflow_flags();
  check_sub_overflow_flags();
  check_cmp_flags_only();
  check_bitwise_and_shift();
  check_branch_control_flow();
  check_stack_push_pop();
  check_call_ret_discipline();
  check_simd_vadd();
  check_simd_vsub();
  check_simd_vxor_flag_stability();
  check_assembler_exact_encoding();
  check_str_and_branch_memory_program();
  check_loop_sum_program();
  check_nested_call_program();
  check_invalid_source();
  check_large_label_sets();
  check_randomized_alu_cmp_properties();
  check_cycle_budget_constraints();
  check_run_throughput();
  check_simd_throughput();
  check_assembler_label_lookup_benchmark();
  check_assembler_mnemonic_decode_benchmark();
  check_wraparound_fetch();

  dlclose(lib);
  return failures == 0 ? 0 : 1;
}
`;
}

# Level 3 candidate inventory

Each version contains **24 candidate source files: eight task families in C, C++, and Rust**. They are reviewed, reusable solution sources promoted from the research workflow so a fresh checkout does not depend on private run directories. They are not synthetic challenge inputs, and the two versioned copies are not 48 independently developed solutions.

The source of truth is the registry: [V2](../solutions/v2/src/level3/candidates.ts) and [V3](../solutions/v3/src/level3/candidates.ts). A registry entry records the task name, language, source path, provenance label, and optional historical server-verification flag.

## Coverage matrix

**Recorded** means the registry has `serverVerified: true` from a historical server validation. **Unverified** means no such claim is attached; it does not mean the code has never been compiled or locally tested. The status matrix is the same in V2 and V3. V3 carries these historical records forward rather than claiming all candidates were revalidated against the V3 service.

Cells link to the V3 source. The family column also links to the corresponding V2 directory.

| Task family | C | C++ | Rust |
|---|---|---|---|
| 16-bit CPU Emulator · [V2](../solutions/v2/fixtures/level3-candidates/cpu-emulator) | [Recorded](../solutions/v3/fixtures/level3-candidates/cpu-emulator/c.c) | [Recorded](../solutions/v3/fixtures/level3-candidates/cpu-emulator/cpp.cpp) | [Recorded](../solutions/v3/fixtures/level3-candidates/cpu-emulator/rust.rs) |
| Dependency Attestation Admission Gate · [V2](../solutions/v2/fixtures/level3-candidates/dependency-attestation) | [Unverified](../solutions/v3/fixtures/level3-candidates/dependency-attestation/c.c) | [Unverified](../solutions/v3/fixtures/level3-candidates/dependency-attestation/cpp.cpp) | [Unverified](../solutions/v3/fixtures/level3-candidates/dependency-attestation/rust.rs) |
| Distributed Flag Snapshot Rollout Engine · [V2](../solutions/v2/fixtures/level3-candidates/distributed-flag) | [Recorded](../solutions/v3/fixtures/level3-candidates/distributed-flag/c.c) | [Recorded](../solutions/v3/fixtures/level3-candidates/distributed-flag/cpp.cpp) | [Recorded](../solutions/v3/fixtures/level3-candidates/distributed-flag/rust.rs) |
| Identity Bundle Auth Resolver · [V2](../solutions/v2/fixtures/level3-candidates/identity-bundle) | [Recorded](../solutions/v3/fixtures/level3-candidates/identity-bundle/c.c) | [Recorded](../solutions/v3/fixtures/level3-candidates/identity-bundle/cpp.cpp) | [Recorded](../solutions/v3/fixtures/level3-candidates/identity-bundle/rust.rs) |
| Lua Bytecode VM · [V2](../solutions/v2/fixtures/level3-candidates/lua-bytecode-vm) | [Recorded](../solutions/v3/fixtures/level3-candidates/lua-bytecode-vm/c.c) | [Recorded](../solutions/v3/fixtures/level3-candidates/lua-bytecode-vm/cpp.cpp) | [Recorded](../solutions/v3/fixtures/level3-candidates/lua-bytecode-vm/rust.rs) |
| Session Credential Rotation Compat Registry · [V2](../solutions/v2/fixtures/level3-candidates/session-credential) | [Unverified](../solutions/v3/fixtures/level3-candidates/session-credential/c.c) | [Unverified](../solutions/v3/fixtures/level3-candidates/session-credential/cpp.cpp) | [Unverified](../solutions/v3/fixtures/level3-candidates/session-credential/rust.rs) |
| Trait Expression AST · [V2](../solutions/v2/fixtures/level3-candidates/trait-expression) | [Unverified](../solutions/v3/fixtures/level3-candidates/trait-expression/c.c) | [Unverified](../solutions/v3/fixtures/level3-candidates/trait-expression/cpp.cpp) | [Unverified](../solutions/v3/fixtures/level3-candidates/trait-expression/rust.rs) |
| Versioned Policy Rollout Engine · [V2](../solutions/v2/fixtures/level3-candidates/versioned-policy) | [Unverified](../solutions/v3/fixtures/level3-candidates/versioned-policy/c.c) | [Unverified](../solutions/v3/fixtures/level3-candidates/versioned-policy/cpp.cpp) | [Unverified](../solutions/v3/fixtures/level3-candidates/versioned-policy/rust.rs) |

Totals per snapshot: **12 historically server-verified, 12 unverified**. Raw proof payloads are intentionally not distributed, so a public reader can inspect the recorded metadata and local tests but cannot independently reconstruct those server events from this checkout. No cell is a certification of today's challenge deployment, score, or hidden tests.

## Provenance and the V3 repairs

| Registry label | V2 sources | V3 sources | Interpretation |
|---|---:|---:|---|
| `gpt-5.5` | 21 | 18 | Retained model-assisted source attribution. It is not evidence of a specific API transport or a complete authorship audit. |
| `manual` | 3 | 6 | The three CPU candidates, plus the three repaired attestation candidates in V3. A repaired fork may still contain model-assisted source. |

V3's Dependency Attestation Admission Gate sources preserve the same unverified status after repair. The C and C++ changes retain memoized dependency results across calls instead of repeatedly traversing deep chains. The Rust changes also align mutation success/failure conventions. Their [registry comments](../solutions/v3/src/level3/candidates.ts) record historical local performance and differential-testing observations. Those observations do not upgrade a local repair into a server-verified candidate.

This distinction is the reason for keeping the versioned sources separate: readers can compare an earlier implementation with the repair without silently rewriting the historical solution.

## How candidates enter the solver

The normal loader accepts only historically verified entries. `findLevel3Candidate` can inspect any entry; `findVerifiedLevel3Candidate` and the default `loadLevel3CandidateCode` enforce the historical-verification flag. An explicit `allowUnverified` lookup exists for controlled local work.

The default Level 3 solver mode is `hybrid`; `candidate` mode requires an eligible registered candidate instead of treating an arbitrary fixture as an automatic live input. Sources are normalized before use, including expansion of C/C++ `EXPORT` macros. See [the registry](../solutions/v3/src/level3/candidates.ts), [mode selection](../solutions/v3/src/level3/solver-mode.ts), and [registry tests](../solutions/v3/tests/level3-candidates.test.ts).

Historical verification is a useful routing hint, not a reason to skip a fresh contract review. The [V3 retrospective](findings/v3-retrospective.md) explains how a registered Lua C++ source was used in one successful final run; it does not generalize that outcome to the whole matrix.

## What the local checks prove

| Check | Scope | What a pass does not establish |
|---|---|---|
| `level3:candidates:check` | Compile every registry source under the local native toolchain. | Correct ABI semantics, hidden-test coverage, server acceptance, or scoring. |
| `level3:components:preflight` | By default, the 12 historically verified entries: six CPU/identity language variants get built-in semantic checks; six distributed-flag/Lua variants get compile-only checks. | Semantic coverage for the compile-only families or current live compatibility. |
| Component preflight with unverified entries included | All 24 entries: the same six receive built-in semantics and the remaining 18 are compile-only. | That all 24 have semantic tests or have been server-validated. |
| Unit and regression suite | Routing, normalization, compilation behavior, verifier behavior, templates, and specific known failures. | Exhaustive evaluation of all candidate implementations. |
| Synthetic V3 rehearsal | One Level 1 fixture, one Level 2 catalog match, and compilation of a registered Level 3 source. | A replay of a live timed run, all-family coverage, or a leaderboard result. |

Compile both registries from the repository root:

```sh
npm run level3:candidates:check --workspace @cheetcode-solutions/v2
npm run level3:candidates:check --workspace @cheetcode-solutions/v3
```

Run the V3 component checks, optionally including the unverified sources:

```sh
npm run level3:components:preflight --workspace @cheetcode-solutions/v3
LEVEL3_COMPONENT_PREFLIGHT_INCLUDE_UNVERIFIED=1 npm run level3:components:preflight --workspace @cheetcode-solutions/v3
```

These commands make no network requests. They require native compilers and execute local verification code. The candidate compile command writes to a temporary directory; component preflight writes its report under the workspace's ignored output directory.

### Semantic evidence has limits

The built-in verifier dispatches only to the CPU emulator and identity resolver. It can also accept a generated verifier, but an unusable generated verifier with no checks is marked unsupported and skipped. Inspect `semantic.supported` and the check count; `ok: true` alone can mean only that compilation succeeded. See [local-verify.ts](../solutions/v3/src/level3/local-verify.ts) and [regression tests](../solutions/v3/tests/level3-local-verify.test.ts).

Additional [C harnesses](../solutions/v3/src/level3/harnesses) preserve targeted credential, attestation, and trait-expression experiments, including differential and scale probes. They are research tools, not a claim that the default component command runs them all. Differential agreement with an earlier implementation also cannot rule out a bug shared by both versions.

## Reading and contribution map

- Begin with [registry tests](../solutions/v3/tests/level3-candidates.test.ts) for the lookup and eligibility contract.
- Read [compiler configuration](../solutions/v3/src/level3/local-compile.ts) and [compiler tests](../solutions/v3/tests/level3-local-compile.test.ts) for the local build boundary.
- Use [component selection](../solutions/v3/src/level3/component-preflight.ts) and [component tests](../solutions/v3/tests/level3-component-preflight.test.ts) to see exactly which checks run.
- Compare the [V2 candidate tree](../solutions/v2/fixtures/level3-candidates) and [V3 candidate tree](../solutions/v3/fixtures/level3-candidates) before editing a historical implementation.
- Keep raw attempts private. Promote only reviewed, attributable sources and redacted findings under the [artifact policy](artifacts.md) and [contribution guide](../CONTRIBUTING.md).

When adding a candidate, record its provenance, keep it unverified unless there is explicit historical server evidence, add a focused regression, and report compile, semantic, and server outcomes separately. Do not fabricate a proof or copy a verification flag from a related language variant.

# V2 retrospective: turn repeated work into a solver

[← Documentation](../README.md) · [V2 code](../../solutions/v2/README.md) · [Next: V3 →](v3-retrospective.md)

**May 2026 · Historical reconstruction · 60/60 solved · 3,950 points**

V2 established the core approach: use deterministic code where the problem family is recognizable, retrieve answers from source where possible, and spend model generation on genuinely unresolved systems work. The path was iterative. It included failed catalogs, partial finishes, misleading bonus hypotheses, and candidates that compiled without being correct.

The account-specific result below was reconstructed from private run and leaderboard records. Those authenticated artifacts are not distributed; the public workspace preserves the implementation and selected regression evidence. [Evidence ledger](evidence.md#historical-outcomes)

## 1. A static answer bank was the wrong abstraction

An early Level 1 catalog returned **0/25** when the problem bank changed. The issue was not simply model quality: the saved answers represented an old session rather than the current problem contract.

The durable replacement was a catalog of **function-family implementations**. The solver inspects the current signature and emits code for a recognized family, then uses available examples and fallback generation for uncertainty. The preserved catalog has 95 factories; this count describes supported entries, not universal coverage of future banks.

Inspect: [deterministic factories](../../solutions/v2/src/level1/solutions.ts), [model fallback](../../solutions/v2/src/level1/llm.ts), [solver tests](../../solutions/v2/tests/level1-solver.test.ts).

## 2. Source-grounded answers reduced unnecessary generation

Level 2 asked about real codebases. The effective ordering was application-catalog retrieval first, repository/source search second, and model assistance last. Normalizing the question and keeping evidence with the answer reduced the amount of open-ended guessing in the timed path.

The repository preserves the catalog adapter and GitHub CLI source tools, but not the full captured application corpus. A synthetic catalog entry demonstrates the mechanism in the [V3 local rehearsal](../../solutions/v3/fixtures/rehearsal/README.md).

Inspect: [catalog extraction/matching](../../solutions/v2/src/level2/catalog.ts), [source tools](../../solutions/v2/src/level2/tools.ts), [catalog tests](../../solutions/v2/tests/level2-catalog.test.ts).

## 3. Native code needed more than a compiler

Level 3 exposed different failures at different layers: public ABI mismatches, incorrect state transitions, boundary cases, and scale behavior. A successful compilation established only the first part of that story.

The pipeline accumulated candidate sources, family templates, local verification, and server-feedback repair. Previewing the family and language made preparation more useful. Generated implementations were inspected and repaired rather than treated as correct because a model had produced them.

The curated V2 registry contains 24 candidates across eight families and C/C++/Rust. Twelve carry historical server-verification annotations. The other twelve remain explicitly unverified; some are useful local research artifacts, not safe fast-path assumptions.

Inspect: [candidate registry](../../solutions/v2/src/level3/candidates.ts), [local verification](../../solutions/v2/src/level3/local-verify.ts), [native candidate matrix](../candidates.md).

## 4. Validation and account history mattered

A first primary-account finish returned **24/25** on Level 1 and affected retry history. Passing local examples was not enough to justify a scored finish. The operational lesson was to validate the exact payload where the server offered that facility, and to stop on a miss rather than assume the next step would repair it.

The API and browser paths also did not represent identical UI state: creating a Level 3 session by API did not automatically render its challenge in the browser. The preserved [headful runner](../../solutions/v2/src/full-headful-runner.ts) and [UI-session adapter](../../solutions/v2/src/level3/ui-session.ts) make that distinction visible.

## 5. Score accounting resolved the bonus confusion

The reconstructed final result was:

| Level | Score |
|---|---:|
| Level 1 | 1,370 |
| Level 2 | 1,050 |
| Level 3 | 1,530 |
| **Total** | **3,950** |

All confirmed V2 trickery points came from Level 1: `speed_demon` (+100), `flag_finder` (+150), and `header_hack` (+100). A separate victory/contact form accepted a flag-shaped value but did not change ELO.

Several approaches did not explain the missing score: L2/L3 speed tricks, negative elapsed values, validation reordering, over-answering, fingerprint changes, polyglot submissions, and ordinary lead-form guesses. Named score components and observed deltas were more useful than UI wording or another speculative probe.

These names and values are historical findings, not instructions to replay a V2 payload against a later service.

## What carried into V3

- Solve the current contract, not the last session's identifiers.
- Retrieve evidence before asking a model to invent an answer.
- Preserve ABI and successful behavior during a focused repair.
- Separate compile, semantic, validation, finish, and leaderboard evidence.
- Keep the account/session boundary explicit and respect failed gates.

The reusable part was the engineering method. V2 endpoints, flags, headers, score constants, and timing assumptions still required fresh investigation for V3. [Continue to the V3 story →](v3-retrospective.md)

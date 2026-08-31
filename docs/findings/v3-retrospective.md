# V3 retrospective: correctness was necessary, not sufficient

[← V2 story](v2-retrospective.md) · [V3 code](../../solutions/v3/README.md) · [Evidence ledger](evidence.md)

**August 2026 · Historical observed result · 60/60 solved · 3,850 points**

V3 reused the specialist-first approach but challenged two assumptions: that a validated payload would receive a score, and that full correctness meant the maximum score. The final result depended on treating session acceptance, correctness, and latency as separate problems.

The chronology below summarizes private historical run evidence. Public tests preserve local contracts and regressions; they do not independently replay the account history or prove the current server's behavior.

## 1. Start with the new contract

V2's final total was 3,950. V3's observed target was 3,850. Reusing the older bonus model created a misleading search for missing points before the new scoring components were understood.

The retained [public-contract preflight](../../solutions/v3/src/ctf-v3-preflight.ts) checks the expected V3 title, constants, and route strings. It is an early drift detector, not a proof that the full authenticated contract is unchanged. A public shell can omit the relevant bundle; failure must be interpreted rather than automatically escalated into a live run.

## 2. A 25/25 validation could still finish at zero

One investigation produced correct validation responses but a **0/25 scored finish**. That observation ruled out the assumption that validation and finish shared one acceptance boundary.

The practical investigation therefore included identity, cookie/storage provenance, fingerprint hints, and the trusted browser context—not only problem solutions. Browser-native work and isolated session checks were operational tools in that investigation. They are documented as history, not shipped as a cookie-transfer workflow.

The source now requires an explicit account identity and keeps the V3 fingerprint contract visible. This does not reconstruct the server's private integrity rules or prove that every historical zero-score incident had the same cause.

Inspect: [identity resolution](../../solutions/v3/src/identity.ts), [Level 1 API](../../solutions/v3/src/level1/api.ts), [API regression tests](../../solutions/v3/tests/level1-api.test.ts).

## 3. Local preparation and fast execution had different jobs

During preparation, the project explored registered candidates, templates, generated verifiers, focused repair, function decomposition, and semantic/scale harnesses. Some native candidates received manual performance repairs; their registry comments and harnesses preserve the distinction between local evidence and server verification.

During a timed fast path, repeating all that work would consume the speed budget. Historical latency investigations included browser timing, HTTP timing experiments, and cloud VM execution. Those measurements were specific to the observed environment; no universal latency improvement is claimed here.

The architectural outcome was a clear distinction between the normal repair loop and a fast path that uses a previously verified candidate. The [candidate matrix](../candidates.md) explains why a candidate's existence, compilation, and historical server status are different facts.

## 4. The last four points were timing, not correctness

A Level 3 run solved **25/25** but returned **1,526**, leaving an overall total of **3,846**. The recorded breakdown isolated the gap:

| Level 3 component | Before recovery | Final run |
|---|---:|---:|
| Correctness | 25/25 | 25/25 |
| Correctness score | 1,500 | 1,500 |
| Speed component | 26 | 30 |
| Trickery modifier | 0 | 0 |
| **Level 3 score** | **1,526** | **1,530** |

The per-item value was 60; it was metadata explaining the 1,500 correctness score, **not another 60 points to add**. Component-level accounting prevented an unnecessary rewrite of a fully correct solution.

## 5. A failed retry reinforced the candidate gate

An unverified Rust candidate for Dependency Attestation Admission Gate failed all 25 server checks in one speed attempt. Local availability and prior repair work had not made it a server-proven candidate.

After further retries were explicitly authorized, the successful attempt selected **Lua Bytecode VM in C++**, with a registered historically server-verified implementation. It returned 25/25 and the full 30-point speed component. The recorded server elapsed time was **88 ms**. That is the server-reported timed window—not the total time spent researching, generating, compiling, or preparing the solution.

The final observed result was:

| Level | Score |
|---|---:|
| Level 1 | 1,270 |
| Level 2 | 1,050 |
| Level 3 | 1,530 |
| **Total** | **3,850** |

The account/leaderboard observation recorded 60/60 solved. Work stopped after the confirmed target result; the outcome is not a success-rate estimate across arbitrary accounts or attempts.

## What the public package preserves

- Independent V3 contracts and tests rather than silently treating V2 as compatible.
- Candidate provenance, with unverified entries remaining clearly marked.
- Explicit identity/storage configuration and no default personal account.
- A synthetic, network-free rehearsal that needs no private session.
- Native verification tools and honest coverage boundaries.
- The negative results and score accounting, not only the successful final number.

The next useful lesson is the [cross-version failure analysis](failure-analysis.md). For reproducible evidence, start with [local testing](../testing.md); do not mistake a historical score for permission or a guarantee to run the live service.

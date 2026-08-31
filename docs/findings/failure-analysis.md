# What went wrong—and what changed

[← Documentation](../README.md) · [V2 narrative](v2-retrospective.md) · [V3 narrative](v3-retrospective.md)

This is the compact engineering record. Historical observations below come from the [evidence ledger](evidence.md); linked tests demonstrate local behavior, not a new live outcome.

## Challenge-level failures

| Failure | Observation | Better boundary | Inspect |
|---|---|---|---|
| Static answers outlived their bank | A saved Level 1 catalog later returned 0/25. | Match the current function family and inspect its samples; keep fallback uncertainty visible. | [L1 factories](../../solutions/v3/src/level1/solutions.ts), [tests](../../solutions/v3/tests/level1-solver.test.ts) |
| Local examples were treated as a release gate | An early V2 finish returned 24/25 and affected retry history. | Validate the exact payload when an authorized server facility exists; don't equate examples with hidden coverage. | [V2 runner](../../solutions/v2/src/level1-runner.ts) |
| Validation was treated as a finish | V3 could validate 25/25 yet finish at zero. | Keep identity, session integrity, validation, scored finish, and persisted result separate. | [V3 client](../../solutions/v3/src/level1/api.ts), [tests](../../solutions/v3/tests/level1-api.test.ts) |
| Compilation was over-trusted | Native source could compile while failing ABI, semantics, or scale. | Report the actual verification layer; add family-specific checks. | [local verifier](../../solutions/v3/src/level3/local-verify.ts), [tests](../../solutions/v3/tests/level3-local-verify.test.ts) |
| A fast attempt used an unverified candidate | The Rust attestation attempt failed 25/25 server checks. | Candidate existence is not server proof; fast paths default to historically verified entries. | [registry](../../solutions/v3/src/level3/candidates.ts), [candidate tests](../../solutions/v3/tests/level3-candidates.test.ts) |
| Timing loss looked like correctness loss | A correct V3 run scored 1,526 because speed was 26/30. | Reconcile named components before changing solver logic. | [score accounting](v3-retrospective.md#4-the-last-four-points-were-timing-not-correctness) |
| V2 assumptions leaked into V3 | The older 3,950 total suggested a false missing-bonus theory. | Preserve version-specific contracts and dated findings. | [V3 preflight tests](../../solutions/v3/tests/ctf-v3-preflight.test.ts) |
| API session state was mistaken for rendered UI state | A started Level 3 session did not automatically appear in the browser. | Treat UI-session acquisition as its own adapter. | [UI adapter](../../solutions/v3/src/level3/ui-session.ts), [tests](../../solutions/v3/tests/level3-ui-session.test.ts) |

## Repository-level failures

### The public surface was indistinguishable from the investigation

One-off cookie, flag, fingerprint, scoreboard, and timing probes sat beside reusable solvers. Some failed strict TypeScript checks even though tests passed. Private notes and generated captures made it hard to understand which workflow a reader could safely reproduce.

The package now separates V2 and V3, removes tactical probes from the supported tree, keeps raw artifacts outside Git, and turns conclusions into a linked case study. The older history remains preserved; current-tree cleanup is not history erasure.

### “Offline” meant two different things

The Level 3 repair runner was offline from the challenge server but could still call paid model providers. The rehearsal also silently preferred private saved runs when present. Both behaviors made a safe quick start ambiguous.

The [command reference](../commands.md) now classifies side effects, and the [rehearsal](../../solutions/v3/scripts/local-rehearsal.ts) defaults only to committed synthetic inputs. Private input selection is explicit. [Rehearsal tests](../../solutions/v3/tests/local-rehearsal.test.ts) cover the boundary.

### A smoke test could print success despite failed checks

The original rehearsal completed without a failure exit even when examples, catalog matches, or compilation failed. Readiness also compared the length of an output array rather than successful solutions.

It now requires nonempty passing inputs at every layer, exposes overall success, and exits nonzero on failure. JavaScript sample invocation stays inside the VM timeout; the VM is still not a security sandbox.

### Configuration and generated paths were misleading

`.env` loading occurred after imported capture constants had already initialized, and recon did not load it at all. Candidate compilation wrote generated source beside committed fixtures. C and C++ labels could also collide.

Environment initialization now precedes capture configuration, shell values keep precedence, registry sources resolve from the module, and compilation outputs are separated from reviewed source. Regression tests cover both snapshots: [V2 tests](../../solutions/v2/tests) and [V3 tests](../../solutions/v3/tests).

### Documentation drift was not tested

The public preflight ignored its documented URL argument and referred to a removed browser workflow. The root rehearsal alias did not forward arguments correctly. These were small defects that made the whole package feel less trustworthy.

Both CLI contracts now have tests, the README has a safe run sequence, and [local-link checking](../../scripts/check-docs.mjs) runs in the aggregate check and CI. These checks reduce drift; they do not replace review of technical claims or external links.

## Principles to carry forward

1. Name the boundary a test actually covers.
2. Prepare deterministic and verified work before entering a timed path.
3. Record failed hypotheses so the next investigation does not repeat them without new evidence.
4. Treat identity and artifact provenance as part of the system, not administrative details.
5. Make the safest useful command the easiest one to discover.
6. Stop after the intended verified result; extra live attempts are a separate decision.

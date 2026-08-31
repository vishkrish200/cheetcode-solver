# Evidence ledger

[← Documentation](../README.md) · [Testing](../testing.md) · [Artifact policy](../artifacts.md)

This ledger makes a deliberate distinction: the repository contains public source and local reproducers, while account-specific score records remain private. A written summary of private evidence is not independent public proof.

## Historical outcomes

| ID | Claim | Period / version | Evidence available to the maintainer | Public boundary |
|---|---|---|---|---|
| V2-FINAL | 60/60; 1,370 + 1,050 + 1,530 = 3,950 | May 2026 · V2 | Saved scored responses and leaderboard record, reconstructed in a later retrospective. | [V2 narrative](v2-retrospective.md); raw authenticated records omitted. |
| V2-BONUS | Confirmed +100 speed, +150 flag, +100 header points came from Level 1. | May 2026 · V2 | Named exploit responses and score-delta investigation. | Historical finding, not a current endpoint/bonus guarantee. |
| V3-FINISH | Validation success did not guarantee scored-finish success. | August 2026 · V3 | Validation/finish responses and browser/session investigation. | [Client and tests](../../solutions/v3/tests/level1-api.test.ts) preserve local contract handling, not the private anti-abuse system. |
| V3-GAP | 25/25 Level 3 checks scored 1,526 with speed 26/30. | August 2026 · V3 | Saved component-level score response. | [Score reconstruction](v3-retrospective.md#4-the-last-four-points-were-timing-not-correctness). |
| V3-RETRY | An unverified Rust attestation candidate failed; verified Lua C++ succeeded later. | August 2026 · V3 | Separate failed and successful run records. | A bounded historical sequence, not an aggregate success rate. |
| V3-FINAL | 60/60; 1,270 + 1,050 + 1,530 = 3,850; final Level 3 speed 30. | August 2026 · V3 | Scored response and final account/leaderboard observation. | [V3 narrative](v3-retrospective.md); not independently replayable from the public fixtures. |
| V3-TIMING | Final Level 3 server elapsed time reported as 88 ms. | August 2026 · V3 | Successful result metadata. | Server-timed window only; excludes research, preparation, and generation. |

These are historical maintainer-reported findings. Account identifiers, session identifiers, raw prompts, cookies, fingerprints, and private filesystem paths are intentionally absent.

## Publicly inspectable evidence

| Artifact | What a reader can verify |
|---|---|
| [V2 tests](../../solutions/v2/tests) and [V3 tests](../../solutions/v3/tests) | Local solver, parser, policy, CLI, and verification regressions. |
| [Synthetic rehearsal inputs](../../solutions/v3/fixtures/rehearsal) | A small credential-free, network-free local pipeline. |
| [Candidate sources](../../solutions/v3/fixtures/level3-candidates) | Source content and local compilation/harness behavior. |
| [Candidate registries](../candidates.md) | Recorded provenance and historical flags; omitted proof payloads cannot be independently inspected here. |
| [CI definition](../../.github/workflows/ci.yml) | Which commands automation runs; actual run results remain separate evidence. |
| [Git history](../../README.md#two-snapshots-deliberately-separate) | Version lineage and packaging changes, not a complete record of every live attempt. |

Do not derive an attempt count from the number of local directories. Captures can be partial, duplicated, or missing account metadata; they are not an authoritative server attempt ledger.

## Adding a new claim

Give it a version, date, exact scope, and evidence class. Include a reproducible local command when one exists. For private live evidence, say which fields support the claim without publishing the underlying sensitive payload. Record negative results and unresolved alternatives as carefully as successful ones.

Never manufacture a synthetic “proof” file that looks like a server response. Synthetic fixtures should remain unmistakably synthetic, and historical claims should retain their private-evidence limitation.

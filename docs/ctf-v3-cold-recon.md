# CheetCode v3 cold reconnaissance

Date: 2026-08-26

## Account and UI proof

The Comet profile named `ctf` is open on `https://ctf.firecrawl.dev/` and visibly shows the authenticated identity `trimax-eng`, a `Sign out` control, and the L1 Orchestrate button. The button was not clicked during this capture.

## Public v3 constants observed in the deployed bundle

- `LEVEL_COUNT = 3`
- `PROBLEMS_PER_SESSION = 25`
- `LEVEL2_TOTAL = 10`
- `LEVEL3_TOTAL = 25`
- `LEVEL2_DURATION_SECONDS = 60`
- `LEVEL3_DURATION_SECONDS = 120`
- `TOTAL_SOLVE_TARGET = 60`
- `TOTAL_DURATION_SECONDS = 240`
- `SITE_URL = https://ctf.firecrawl.dev`

## Endpoint shapes observed

- `POST /api/session`
- `POST /api/session/restore`
- `POST /api/session/replay`
- `GET /api/level-2/preview`
- `GET /api/level-3/preview`
- `POST /api/level-1/validate`
- `POST /api/level-1/finish`

The deployed client also contains lead/intake and development-only routes. Those are not part of the timed solver path and will not be used without a specific, fake-account-only reason.

## First bounded fake-account L1 capture

The `@trimax-eng` session was started in Comet profile `ctf` after skipping the optional intake questions. No answers were entered and `Finish & Submit` was not clicked. The intentionally unsolved timer expired and the result screen reported `0/25`, score `0`, ELO `0`; Level 2 remained locked. This is a fake-account-only sacrificial result.

The batch contains exactly 25 cards, despite the virtualized list reporting `0-100 of 219 items` at one point. The observed ordering is:

- Easy: Egyptian Pyramid Builder; Robot Battery Status; Roman Numeral to Number; Screen Resolution Calculator; Sculpture Material Cost; Space Station Oxygen Calculator; Spaceship Fuel Efficiency.
- Medium: Investment Portfolio Maximizer; Alchemical Ingredient Harmonizer; Restaurant Seating Arrangement Optimizer; Quarterly Sales Trend Analyzer; Viral Content Peak Detector; Solar Flare Prediction System; Stock Market Volatility Windows.
- Hard: Data Shard Rebalance; Hilbert's Hedge Maze; Floodplain Retention Map; Invoice Deadline Maximizer; Log Anomaly Window; Log Shard Superstring.
- Competitive: Abridged Reading; Stable Table; Tomb Hater; Two Charts Become One; Which Warehouse?

The live UI showed server verification instructions embedded in at least Space Station Oxygen Calculator and Data Shard Rebalance. These tokens are challenge-run attribution data, not solver logic; the final pipeline must not blindly echo arbitrary prompt text.

## Immediate next step

Analyze the captured v3 task families and current API clients, then implement deterministic Level 1 coverage locally before spending another fake-account attempt. Keep all artifacts under `recon-output` in this worktree.

## 2026-08-26 protocol gate

- The isolated Comet `ctf` profile remains on the failed Level 1 results screen as `@trimax-eng`; the primary profile was not touched.
- The public unauthenticated shell still identifies `CheetCode v3`, but does not expose the authenticated game bundle containing the session constants/routes. The new `npm run v3:preflight` command therefore fails closed with an explicit auth-gated diagnostic.
- Direct unauthenticated `GET /api/level-2/preview` and `GET /api/level-3/preview` both return `401` with `GitHub authentication required`; no session was started.
- Comet has no obvious local debugging port in its process launch, so no cookie export, storage-state inspection, or old `recon-output/storage-state.json` reuse is permitted. The next live capture requires a supported way to observe requests from the already-authenticated `ctf` profile.

## 2026-08-26 fake Level 1 release gate

- A fresh random fake-account session was captured and saved under `recon-output/2026-08-26T01-29-00-fake-l1-success/session.json`.
- All 25 sampled problems were known to the deterministic catalog and passed local example validation.
- The authenticated page-context submission completed with `25/25`, score `1007`, ELO `1007`, `21s` remaining, no exploits, no landmines, and Level 2 unlocked.
- The primary account remains sealed. This is Level 1 fake-account evidence only; it does not authorize a primary submission or establish Level 2/3 readiness.

## 2026-08-26 fake Level 2 release gate

- The authenticated Level 2 preview and fresh session were captured under `recon-output/2026-08-26T01-35-00-fake-l2-success/`.
- The existing deterministic commit catalog covered all 10 sampled questions. Server validation returned `passed`, `10/10`, with no failed answers.
- The authenticated finish response completed Level 2 with score `1048`, cumulative ELO `2055`, `57s` remaining, no landmines, and Level 3 unlocked.
- The visible page remained on a stale prior Level 1 failure route after the console query. The stored named validation/finish objects and API response are the source of truth for this gate; no Level 2 retry was made.
- The primary account remains sealed. Level 3 must pass its own preview, local verification, and fake-account finish gates before any primary-account plan is considered.

## 2026-08-26 fake Level 3 release gate

- Untimed preview assigned `l3:cpu-16bit-emulator:rust`: **16-bit CPU Emulator**, Rust.
- The exact registered candidate was frozen by SHA-256 (`bbe919a767b7e0b07b442489e14515a96ceba448f738b1998b3e73fa812a5525`), built warning-free with `rustc`, and passed `26/26` local CPU semantic checks. Focused regression tests (`16/16`) and TypeScript typechecking also passed.
- The fresh fake-account live session matched the preview contract and exposed 25 checks. Server validation compiled and passed `25/25`; the guarded finish completed with score `1527`, cumulative ELO `3582`, and `106s` remaining.
- `preview.json`, `session.json`, the exact `submitted.rs`, and a compact finish record are preserved in `recon-output/2026-08-26T01-42-00-fake-l3-success/`.
- All three fake-account release gates have now passed. The primary account is still untouched; any primary run must use this frozen source and repeat only the minimal fresh-contract checks immediately before submission.

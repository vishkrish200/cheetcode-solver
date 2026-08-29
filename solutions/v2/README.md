# CheetCode V2 (historical)

This directory contains the curated V2 implementation derived from repository commit `6fb8c76` (May 23, 2026). It is retained for comparison and reproducibility; it is not the maintained live path and its network contract may no longer match the deployed challenge.

## Local checks

From the repository root:

```bash
npm run test:v2
npm run typecheck:v2
```

The package keeps the deterministic Level 1 specialists, tool-first Level 2 catalog, dynamic Level 3 pipeline, headful runner, zero-retry runner, and offline compiler loop. One-off probes and browser-cookie import helpers were removed from this public-facing snapshot; their conclusions are captured in [`../../docs/findings/v2-retrospective.md`](../../docs/findings/v2-retrospective.md).

## Authorized live setup

Live commands are historical and can mutate challenge state. Copy `.env.example` to `.env`, set `CHEETCODE_GITHUB` to the handle associated with the authenticated browser session, and use only an account you are authorized to operate.

```bash
npm run install:browsers --workspace @cheetcode-solutions/v2
npm run recon --workspace @cheetcode-solutions/v2 -- auth
```

The supported solver entry points are `level1`, `level2`, `level3`, `full:headful`, and `zero-retry`. Prefer `level3:offline` before any timed Level 3 run.

## Solver policy

- Level 1: deterministic catalog first; model fallback only for unknown or sample-failing problems.
- Level 2: extracted catalog first, source/tool lookup second, model fallback last.
- Level 3: preview, select a supported family, compile locally, run semantic checks where available, then use server validation.

V2 findings, scores, endpoint names, and bonuses are historical. Do not apply them to V3 or a later deployment without independently rechecking the contract.

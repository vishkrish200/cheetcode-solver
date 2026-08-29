# CheetCode V3

The maintained research snapshot for the V3 challenge contract. It separates offline verification from live server actions and requires an explicit GitHub identity instead of embedding a personal account in source.

## Local checks first

From the repository root:

```bash
npm run test:v3
npm run typecheck:v3
npm run rehearse:v3
```

The rehearsal uses synthetic local fixtures, does not read browser cookies, and does not call `fetch`.

## Public contract preflight

The preflight fetches the public challenge page and checks the expected V3 bundle constants without starting a session:

```bash
npm run preflight:v3 -- https://ctf.firecrawl.dev
```

Treat a failed preflight as contract drift. Update adapters and tests before considering a live run.

## Authorized live setup

Live commands can start or finish challenge sessions. Use them only with explicit authorization and a matching account/session identity.

```bash
cp solutions/v3/.env.example solutions/v3/.env
npm run install:browsers --workspace @cheetcode-solutions/v3
npm run recon --workspace @cheetcode-solutions/v3 -- auth
```

`auth` opens an isolated Playwright browser and saves storage state under the ignored `recon-output` directory after manual OAuth. This public snapshot deliberately does not import cookies from a user's everyday browser profile.

Core entry points:

```bash
npm run level1 --workspace @cheetcode-solutions/v3
npm run level2 --workspace @cheetcode-solutions/v3 -- run
npm run level3:offline --workspace @cheetcode-solutions/v3
npm run level3 --workspace @cheetcode-solutions/v3 -- run
```

## Design rules

- `CHEETCODE_GITHUB` is required and must match the authenticated session.
- Browser-derived fingerprint hints and storage state stay in ignored local files.
- Replay and heartbeat traffic are disabled unless a reproduction explicitly needs them.
- Level 3 speed mode accepts only registered, server-verified candidates by default.
- A local compile is necessary but not sufficient; semantic and server checks remain separate gates.

See [`../../docs/findings/v3-retrospective.md`](../../docs/findings/v3-retrospective.md) and [`../../docs/findings/failure-analysis.md`](../../docs/findings/failure-analysis.md) for the evidence and the failed approaches that motivated these rules.

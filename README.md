# CheetCode CTF Solutions

Versioned solver research for the Firecrawl CheetCode challenge. The repository keeps the completed V2 and V3 work separate, preserves the useful engineering lessons, and intentionally excludes raw browser sessions, credentials, and generated captures.

This is a historical research archive, not a promise that the current challenge still exposes the same endpoints or scoring rules. No live challenge request is made by the default test or typecheck commands.

## Repository map

| Path | Status | Purpose |
|---|---|---|
| [`solutions/v2`](solutions/v2) | Historical | Curated snapshot of the May 2026 V2 solver. |
| [`solutions/v3`](solutions/v3) | Maintained snapshot | V3 contract checks, solvers, offline rehearsal, and semantic harnesses. |
| [`docs/findings`](docs/findings) | Curated evidence | Score reconstruction, failure analysis, and lessons learned. |
| [`docs/architecture.md`](docs/architecture.md) | Design reference | Shared solver flow and version boundaries. |
| [`docs/artifacts.md`](docs/artifacts.md) | Data policy | What is safe to commit and what must remain local. |

## Quick start

Requirements: Node.js 20 or newer. A C/C++ compiler is needed for Level 3 semantic checks.

```bash
npm install
npm run check
```

Useful version-specific checks:

```bash
npm run test:v2
npm run test:v3
npm run typecheck:v2
npm run typecheck:v3
npm run rehearse:v3
```

`npm run rehearse:v3` is offline: it does not read browser cookies or call the challenge server. Commands that authenticate, start sessions, validate, or finish a challenge are documented inside each version and must only be used with an authorized account.

## Historical outcomes

- V2: 60/60 solved and a reconstructed score of 3,950. See [`docs/findings/v2-retrospective.md`](docs/findings/v2-retrospective.md).
- V3: 60/60 solved and a verified final score of 3,850. See [`docs/findings/v3-retrospective.md`](docs/findings/v3-retrospective.md).

These are historical results backed by private local captures. The raw authenticated artifacts are not part of this repository and the figures are not claims about the current live service.

## Security and scope

Never commit `.env` files, Playwright storage state, cookies, fingerprint payloads, HAR files, prompts from private sessions, or unredacted network captures. See [`SECURITY.md`](SECURITY.md) before adding evidence.

This project is not affiliated with or endorsed by Firecrawl. Use it only on systems and accounts you are authorized to test.

## License

MIT. See [`LICENSE`](LICENSE).

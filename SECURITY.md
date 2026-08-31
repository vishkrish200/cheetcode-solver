# Security and responsible use

This repository contains historical challenge tooling, model-assisted code generation, native execution, and browser capture. Its local test success does not make every command safe for untrusted inputs or authorize any live operation.

## Sensitive state

Never commit or share API keys, OAuth tokens, cookies, `.env` files, Playwright storage state, browser profiles, fingerprint payloads, HAR files, private prompts, or unredacted captures. `.gitignore` covers common filenames; it is not access control and does not remove files already committed.

Capture code can collect input values, DOM content, screenshots, local/session storage, and network bodies. Built-in redaction is best-effort. Treat all captures and summaries as private until separately reviewed. Some diagnostic commands can print sensitive data to stdout; check the [command reference](docs/commands.md).

## Untrusted code and provider calls

- Native harnesses and generated verifiers compile and execute code on the host. Timeouts are not a sandbox.
- Node VM sample execution is also not a security boundary. Use trusted fixtures or a disposable, appropriately isolated environment.
- Model-assisted commands may send challenge text, source code, and repair context to the selected external provider and incur cost.
- `level3:offline` means offline from the challenge server, not necessarily from the network. The credential-free `rehearse:v3` is the network-free demo.
- The public snapshot does not extract cookies from an everyday browser profile. Do not reintroduce that behavior as a convenience feature.

## Live system boundaries

Operate only systems and accounts you are authorized to test. Historical routes, score constants, and candidate annotations do not establish current permission or compatibility. Stop on rate limits, identity mismatch, ambiguous state, or unexpected scores. Authentication, validation, finish, and leaderboard persistence are distinct outcomes.

This project is independent of Firecrawl. If a finding affects the challenge service rather than this repository, use the service owner's appropriate private reporting channel; do not publish active account state or sensitive reproduction payloads here.

## Reporting a repository issue

Do not open a public issue containing a secret or raw session artifact. Use an existing private contact with the repository maintainer, or the repository's private vulnerability-reporting option if one is available. If no private channel is available, a public request to establish contact should contain no sensitive details.

For an exposed credential you control, revoke or rotate it promptly. Coordinate repository/history cleanup with the maintainer; deleting the current file alone does not remove earlier copies. Avoid destructive history rewrites before identifying affected refs and coordinating with collaborators.

## Before publication

```bash
npm run check
gitleaks git --redact
gitleaks git --staged --redact
```

Review the current tree **and full history** for personal data and redistribution issues that a pattern-based secret scanner cannot detect. Earlier tactical workflows remain in preserved Git history; the curated tree is not a claim that history was erased. See [artifact provenance](docs/artifacts.md).

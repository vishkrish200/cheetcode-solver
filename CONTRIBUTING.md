# Contributing

Thank you for helping make this a clearer, more reproducible engineering case study. Useful contributions include focused correctness fixes, synthetic regression cases, improved evidence descriptions, and documentation that makes a component easier to understand.

## Version policy

- **V2 is historical.** Limit behavior changes to reproducibility, security, or a clearly documented correction. Preserve the original research meaning.
- **V3 is the primary research snapshot.** New fixes belong here unless the same packaging/security defect affects both versions.
- Keep version-specific contracts independent. Do not silently share a network adapter or change a historical score assumption.
- Preserve provenance. A manual repair to generated code should remain identifiable as a repair, not a freshly server-verified result.

## Local workflow

```bash
npm ci
npm run doctor
npm run check
npm run rehearse:v3
```

Use a focused branch, add a regression test in the affected workspace, and keep the diff scoped. Run the full native candidate check when changing candidate source; see [testing](docs/testing.md). No account or paid provider is needed for the default checks.

## Pull request checklist

- Explain the problem, change, and evidence in plain language.
- State which version is affected and whether behavior changed.
- Include the exact local commands run and their outcomes.
- Add/update tests and local documentation links.
- Distinguish compile-only, local semantic, and historical server evidence.
- Inspect the staged diff for secrets, personal identifiers, raw prompts, and captures.
- Keep the root lockfile synchronized; do not add nested lockfiles or unused dependencies.

If available, run `gitleaks git --staged --redact` before committing. A clean scan complements manual review; it does not prove privacy or correct attribution. [Artifact policy](docs/artifacts.md)

## What not to include

Do not attach raw `recon-output` directories, browser storage, HAR files, fingerprint hints, provider keys, private session prompts, or unreviewed third-party source. Prefer a small synthetic fixture or a redacted derived finding.

Do not add live challenge calls, authentication, provider spending, or account mutations to CI. A green local test suite is not authorization for those actions. Live experiments need explicit permission, a budget/stop condition, and an evidence plan separate from the code review.

## Bug reports and research findings

For a bug, include OS, Node/compiler versions, the exact command and workspace, expected behavior, and a redacted error. For a research finding, include its date, challenge version, hypothesis, observation, alternatives, and evidence class. See the [evidence ledger](docs/findings/evidence.md).

Please report sensitive data exposure privately rather than opening an issue containing the value. [Security policy](SECURITY.md)

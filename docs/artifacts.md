# Artifact policy and provenance

[← Documentation](README.md) · [Evidence ledger](findings/evidence.md) · [Security](../SECURITY.md)

Keep the reusable method public and sensitive operational state private. An ignored file is still sensitive; a redaction helper is not a guarantee that a capture is safe to share.

## Three distinct classes

| Class | Examples | Repository treatment |
|---|---|---|
| Reviewed source | Solver factories, model-assisted native candidates, manual repairs, harnesses, tests. | Committed, with provenance and verification limits. |
| Synthetic demonstration data | One Level 1 problem, one Level 2 catalog entry, minimal Level 3 rehearsal descriptor. | Committed under `solutions/v3/fixtures/rehearsal`; explicitly labeled synthetic. |
| Private run data | Authenticated captures, prompts, generated per-run variants, response bodies, tokens, screenshots, compiler/run logs. | Ignored and kept locally; publish only a separately reviewed minimal derivative. |

The native candidate directories are **not all synthetic data**. They are curated implementation source, including model-generated and manually repaired code. Registry annotations record their lineage. Raw generations, prompts, and private server proof payloads are not shipped. See [candidate provenance](candidates.md).

## Local-only material

Never commit:

- `.env` files, API keys, OAuth tokens, cookies, browser profiles, or Playwright storage state;
- fingerprints, device-signature payloads, account/session identifiers, or private authentication traces;
- HAR files, raw DOM/network captures, local/session storage dumps, or screenshots containing personal data;
- captured challenge prompts or third-party material without a reviewed redistribution basis;
- bulk per-run generated candidates, compiled binaries, or orchestration logs.

Default runtime output lives under ignored workspace directories such as `recon-output/`. Candidate compilation checks use temporary output directories. The earlier cleanup moved accumulated raw data to a private archive outside the checkout rather than committing or destroying it.

## Capture is not publication

[Capture code](../solutions/v3/src/recon/capture.ts) can record screenshots, DOM content, input values, browser storage, and network data. [Redaction](../solutions/v3/src/recon/redact.ts) recognizes some patterns but cannot identify every personal value, fingerprint, or secret. Treat every capture and derived summary as private until human review establishes otherwise.

Even preview and fingerprint commands can print sensitive identifiers to the terminal. Do not paste their unredacted output into issues, PRs, public logs, or chat.

## Publish a finding safely

1. State the question, version, date, and outcome.
2. Name the evidence class: local test, compile, local semantics, public fetch, server validation, scored finish, or leaderboard observation.
3. Include only the fields necessary to support the conclusion. Replace account identities with neutral descriptions.
4. Remove credentials, identifiers, private paths, headers, raw request bodies, and unrelated challenge/source content.
5. Preserve attribution for reviewed implementation sources and third-party material.
6. Run `npm run check`, inspect the staged diff, and run a staged secret scan before committing.

A useful report says “25/25 correctness; speed 26/30; total 1,526” and explains its private historical origin. It does not need a full browser export.

## History and visibility

This is a curated current tree on top of preserved Git history. Removed tactical scripts and older documentation can remain reachable in earlier commits. Moving files or adding `.gitignore` rules does not remove previously committed content.

Before changing repository visibility or publishing a release archive, review both the current tree and complete history for secrets, personal information, and redistribution constraints. A secret scanner catches known patterns, not every privacy or provenance problem. History rewriting and credential rotation are separate actions and should be coordinated explicitly.

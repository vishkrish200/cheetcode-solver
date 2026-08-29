# Artifact policy

## Committed artifacts

Only durable, reviewable evidence belongs in Git:

- redacted retrospectives and failure analyses;
- synthetic fixtures with no session-derived prompts or answers;
- deterministic test expectations;
- source code and local verification harnesses.

## Local-only artifacts

The following must remain ignored and private:

- `.env` files and provider keys;
- Playwright storage state, cookies, OAuth tokens, and browser profiles;
- fingerprint identifiers or device-signature payloads;
- HAR files and unredacted network/request bodies;
- challenge prompts, generated candidates, compiler products, and bulk screenshots;
- raw run directories under `recon-output`, `output`, or `level1-output`.

The cleanup moved the pre-existing raw output directories into a private sibling archive instead of adding them to Git. They are supporting material, not distributable repository content.

## Adding evidence

Before committing a new fixture or report:

1. Remove cookies, authorization headers, handles, emails, filesystem paths, fingerprints, and request bodies that are not essential to the claim.
2. Replace account identifiers with neutral placeholders.
3. State whether the evidence is offline, public read-only, server-validated, scored, or leaderboard-verified.
4. Run `gitleaks git --staged --redact` and the full `npm run check` suite.
5. Prefer a compact derived JSON or Markdown result over a raw capture.

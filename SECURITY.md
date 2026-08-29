# Security policy

## Sensitive local state

Do not commit or share authentication cookies, OAuth tokens, Playwright storage state, `.env` files, browser profiles, fingerprint payloads, HAR files, or unredacted CheetCode captures. The repository ignore rules cover common filenames, but contributors are responsible for reviewing staged content.

Use the isolated Playwright `auth` flow for an authorized session. This public snapshot intentionally does not extract cookies from a normal browser profile.

## Reporting a repository issue

If a committed file appears to contain a credential or personal session artifact, do not open a public issue containing the value. Revoke the credential first, remove it from the current tree and Git history, then notify the repository owner through a private channel.

Before every release, run:

```bash
gitleaks git --redact
gitleaks git --staged --redact
npm run check
```

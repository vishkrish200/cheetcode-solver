# Testing and evidence

[← Documentation](README.md) · [Evidence ledger](findings/evidence.md)

The test suite is designed to catch regressions in a research implementation. It is not a local simulator of the challenge's hidden grader, timing system, account history, or anti-abuse checks.

## Local commands

```bash
npm run doctor
npm run check
npm run rehearse:v3
```

`check` runs local-link validation, strict TypeScript checks, repository utility tests, and both Vitest suites. Unit tests use local fixtures/mocks and native harnesses; they do not call the challenge or paid providers. `rehearse:v3` uses the committed synthetic inputs by default and fails if any required local check fails.

After modifying native candidates, and with `cc`, `c++`, and `rustc` installed:

```bash
npm run level3:candidates:check --workspace @cheetcode-solutions/v2
npm run level3:candidates:check --workspace @cheetcode-solutions/v3
npm run level3:components:preflight --workspace @cheetcode-solutions/v3
```

Candidate checks compile all 24 entries, including unverified candidates, into temporary output directories. Component preflight selects historically server-verified candidates by default and reports whether each result was semantic or compile-only. These commands do not update registry provenance.

## Verification layers

| Layer | What a pass establishes | What remains unproven |
|---|---|---|
| Documentation links | Local files/headings referenced by guides exist. | External URLs and technical correctness of prose. |
| Typecheck | TypeScript satisfies the configured static contracts. | Runtime input correctness or native semantics. |
| Unit tests/examples | The tested cases and policies behave as expected. | Complete challenge-bank or hidden-case coverage. |
| Native compilation | The compiler accepts the source under that command's flags. | Correct runtime behavior and performance. |
| Local semantic harness | The implemented local checks pass for that candidate. | The private server grader and unmodeled edge cases. |
| Server validation | The server accepted the tested payload in that historical context. | A scored finish, future compatibility, or a leaderboard update. |
| Scored finish | A particular run returned a score. | Durable account-level display or universal repeatability. |
| Leaderboard observation | The historical result was visible in the account/leaderboard state. | The current service or independent public reproduction. |

Keep the evidence label attached when summarizing a result. “Compiled,” “locally verified,” and “server-verified” should never be used interchangeably.

## What the rehearsal actually covers

The [synthetic fixtures](../solutions/v3/fixtures/rehearsal/README.md) are intentionally small:

- One known Level 1 problem with a nonempty sample set.
- One Level 2 question and one local catalog entry.
- One Level 3 Lua Bytecode VM C++ candidate and a compiler invocation.

They prove the local path is wired together and does not require private captures. They do not reproduce all 60 scored checks, execute the historical Lua hidden grader, measure server latency, or establish a new score.

Regression tests also check fixture-first defaults, argument forwarding/validation, failure exits, environment precedence, and module-relative candidate paths. These are part of the newcomer experience, not only internal utilities.

## Semantic coverage is deliberately explicit

The [component selector](../solutions/v3/src/level3/component-preflight.ts) uses built-in semantic verification for **16-bit CPU Emulator** and **Identity Bundle Auth Resolver**. It compiles the other selected families without claiming a semantic pass for them.

Additional [C harnesses](../solutions/v3/src/level3/harnesses) preserve targeted experiments for attestation, credentials, and trait expressions. Their presence does not mean every candidate is automatically covered by the default suite. Generated verifiers are optional and need independent scrutiny. Consult the [candidate matrix](candidates.md) and the detailed local verification record.

Native tests and generated verifiers run code on the host. Run only trusted code locally; use a disposable, appropriately restricted environment for unfamiliar candidates. Node VM contexts and process timeouts do not provide a security boundary.

## CI and reproducibility

[CI](../.github/workflows/ci.yml) installs the root lockfile on Ubuntu with Node 22, checks the environment, runs the repository checks and synthetic rehearsal, then audits dependencies. It does not authenticate to CheetCode, install an interactive browser profile, supply provider keys, or submit challenges.

The public package has one root `package-lock.json`. Keep it in sync with manifest changes. Use `npm ci` for review/reproduction; it replaces local dependency installations with the lockfile's contents.

When reporting verification, include the commit, OS/toolchain, command, exit status, and relevant coverage. The terminal test totals are authoritative for that checkout; a README badge or an older report should not override them.

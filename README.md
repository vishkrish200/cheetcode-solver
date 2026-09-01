# CheetCode: two challenges, one engineering notebook

An implementation and retrospective of solving Firecrawl's CheetCode V2 and V3: timed programming, source-code retrieval, and native systems challenges, with deterministic solvers, model-assisted generation, and progressively stronger verification.

**V2: 60/60 · 3,950 points** &nbsp; / &nbsp; **V3: 60/60 · 3,850 points**

These are **historical outcomes**, not a live benchmark or a promise that today's challenge still accepts these solutions. V2 is reconstructed from May 2026 records; V3 was observed in August 2026. Authenticated captures remain private. The code, synthetic rehearsal, and limitations are public and inspectable.

[Start locally](#try-it-locally) · [The challenge](docs/challenge.md) · [V2 story](docs/findings/v2-retrospective.md) · [V3 story](docs/findings/v3-retrospective.md) · [Documentation](docs/README.md)

## What was the challenge?

The recorded V3 format allowed **240 seconds** across three very different tasks:

| Level | Work to solve | Our approach |
|---|---|---|
| 1 · Programming | 25 small JavaScript problems | Recognize function families, generate deterministic implementations, check examples, fall back to a model when needed. |
| 2 · Source retrieval | 10 questions about real open-source codebases | Extract a source-grounded catalog, match questions, use bounded repository search for misses. |
| 3 · Systems | One C, C++, or Rust implementation graded by 25 checks | Route by task family and language; use registered candidates or templates; compile, inspect semantics, and repair selectively. |

“60/60” means 25 + 10 + 25 checks—not sixty independently generated systems programs. [Read the format and terminology →](docs/challenge.md)

## Why this repository is worth exploring

The interesting part is how the solving process changed when apparently strong evidence turned out to be insufficient.

- **Generation was only one layer.** Both snapshots include 95 deterministic Level 1 factories and 24 native Level 3 candidates across eight families and three languages.
- **Retrieval often beat invention.** Level 2 used application/source evidence before asking a model to fill a gap.
- **Compilation was not correctness.** ABI checks, local semantic harnesses, differential comparisons, and server feedback caught different failure classes.
- **Correctness was not the whole score.** A fully correct V3 Level 3 result lost four points solely in the speed component.
- **Validation was not a scored finish.** V3 exposed an additional session/identity boundary; a successful validation response could still end in a zero-scored finish.

The [failure analysis](docs/findings/failure-analysis.md) connects these lessons to the code and tests that preserve them. The [toolchain guide](docs/toolchain.md) credits the languages, libraries, model integrations, and historical operational tools without conflating “implemented adapter” with “used in the winning run.”

## Try it locally

Use Node.js 22.12+ in the 22.x line (the CI baseline), or Node 24+, npm, and the `cc`/`c++` compiler commands on macOS or Linux. Rust is optional for the quick start and required for the full native candidate sweep. No challenge account, browser installation, API key, or `.env` file is needed for this path.

```bash
git clone https://github.com/vishkrish200/cheetcode-solver.git
cd cheetcode-solver
npm ci
npm run doctor
npm run check
npm run rehearse:v3
```

After dependency installation, these checks do not contact the challenge or model providers. Tests compile and execute the repository's native harness code; review unfamiliar source before running it. A timeout is not a sandbox.

The rehearsal exercises **one synthetic Level 1 example, one synthetic Level 2 lookup, and compilation of one registered C++ Level 3 candidate**. It is a small end-to-end local smoke test, not a replay of either historical 60/60 result. It exits nonzero if a required local check fails.

[Setup, expected output, and troubleshooting →](docs/getting-started.md)

## Choose a reading path

| If you want to… | Start here | Then explore |
|---|---|---|
| Understand the project in ten minutes | [Challenge overview](docs/challenge.md) | [Architecture](docs/architecture.md) |
| Follow the complete solving journey | [V2 retrospective](docs/findings/v2-retrospective.md) | [V3 retrospective](docs/findings/v3-retrospective.md) |
| Inspect the algorithms | [Candidate matrix](docs/candidates.md) | [V3 implementation](solutions/v3/README.md) |
| Reproduce what is public | [Getting started](docs/getting-started.md) | [Testing and evidence](docs/testing.md) |
| Understand every command and its effects | [Command reference](docs/commands.md) | [Configuration](docs/configuration.md) |
| Add a fix or a finding | [Contributing](CONTRIBUTING.md) | [Artifact policy](docs/artifacts.md) |

## Two snapshots, deliberately separate

```text
cheetcode-solver/
├── solutions/
│   ├── v2/                 May 2026 historical implementation
│   │   ├── src/            solvers, clients, verification, capture
│   │   ├── tests/          version-specific regression suite
│   │   └── fixtures/       reviewed native candidate source
│   └── v3/                 August 2026 research implementation
│       ├── src/            V3 clients, preflight, solvers, verification
│       ├── tests/          V3-specific and shared-lineage regressions
│       ├── scripts/        network-free synthetic rehearsal
│       └── fixtures/       native candidates and synthetic demo inputs
├── docs/                   guides, reference, findings, evidence limits
├── scripts/                environment doctor and documentation checks
└── .github/workflows/      local verification in CI
```

V2 and V3 are independent npm workspaces with one root lockfile. Some code is duplicated intentionally: a historical challenge adapter should not silently change when the newer version evolves. V3 is the primary reading path, not a continuously supported live service. [Version policy →](CONTRIBUTING.md#version-policy)

## Results and evidence

| Snapshot | Level 1 | Level 2 | Level 3 | Total | Evidence boundary |
|---|---:|---:|---:|---:|---|
| V2 · May 2026 | 1,370 | 1,050 | 1,530 | **3,950** | Historical reconstruction from private run and leaderboard records. |
| V3 · August 2026 | 1,270 | 1,050 | 1,530 | **3,850** | Final scored result and leaderboard observation recorded privately. |

Public tests verify local behavior. They cannot independently reproduce the private account history, score, timing, anti-abuse decisions, or current leaderboard. Registry `serverVerified` flags are historical annotations, not fresh certification. See the [evidence ledger](docs/findings/evidence.md).

## Responsible use and attribution

This is an independent, model-assisted research project; it is not affiliated with or endorsed by Firecrawl. Challenge names and third-party material remain attributable to their respective owners. The [toolchain and credits](docs/toolchain.md) describe the work's lineage.

Use live tooling only on systems and accounts you are authorized to test. Commands labeled “offline” are not interchangeable: `rehearse:v3` is network-free, while `level3:offline` can send prompts to a model provider and incur cost. [Check command effects before running anything advanced.](docs/commands.md)

Never publish cookies, storage state, fingerprints, provider keys, or raw captures. See [SECURITY.md](SECURITY.md) and the [artifact policy](docs/artifacts.md).

Project code and documentation are offered under the [MIT license](LICENSE). Dependencies and third-party challenge material retain their own terms.

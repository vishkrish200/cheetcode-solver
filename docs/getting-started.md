# Getting started without an account

[← Documentation](README.md) · [Command reference](commands.md)

The default learning path uses committed source and synthetic inputs. You do not need a CheetCode login, GitHub OAuth, browser storage, provider key, or `.env` file.

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| Node.js and npm | Installation, TypeScript, tests, scripts | Node 22.12+ in the 22.x line, or Node 24+. `.nvmrc` and CI select Node 22; Node 23 is excluded by the locked test toolchain. |
| `cc` and `c++` | Native unit harnesses and rehearsal | The normal `npm run check` suite uses these; they are not only live-run dependencies. |
| `rustc` | Full Level 3 candidate compilation | Optional for the quick start. |
| Chromium, `gh`, `gcloud`, or Codex CLI | Selected browser/search/provider workflows | Not needed for the local quick start. See [toolchain](toolchain.md). |

The scripts assume a Unix-like shell and compiler toolchain. macOS and Linux are the documented paths; Windows users should use a suitable Linux environment such as WSL. Native Windows execution is not validated here.

On macOS, Apple's Command Line Tools provide `cc` and `c++` (`xcode-select --install`). On Debian/Ubuntu, `build-essential` provides the C/C++ build tools. Install toolchains through your normal trusted package-management process. The repository does not install system tools automatically.

## Install and inspect

From the repository root:

```bash
# Optional, if you use nvm:
nvm use

npm ci
npm run doctor
```

`npm ci` installs the root lockfile; it needs access to the package registry. Do not run separate installs inside each workspace. The doctor checks local executable availability and installed dependencies without launching tools, reading `.env`, authenticating, or contacting a server. Missing optional tools do not fail it.

## Run the repository checks

```bash
npm run check
```

This checks Markdown links, strict TypeScript compilation, repository utilities, and both version-specific test suites. It does not contact the challenge or an LLM provider. It **does compile and run native code from this repository**. Review the source and use an isolated environment for unfamiliar code; neither Node's VM nor a process timeout is a security sandbox.

For a narrower loop:

```bash
npm run check:docs
npm run test:v2
npm run test:v3
npm run typecheck:v3
```

Successful tests are local regression evidence, not a new 60/60 challenge result. See [testing and evidence](testing.md).

## Run the synthetic rehearsal

```bash
npm run rehearse:v3
npm run rehearse:v3 -- --help
```

The default always uses the committed [rehearsal fixtures](../solutions/v3/fixtures/rehearsal/README.md), even if private run directories exist locally. Expected checks:

- Level 1: one recognized implementation, one passing sample set.
- Level 2: one catalog match for one question.
- Level 3: the registered Lua Bytecode VM C++ source is found and compiles.

Every required check must pass for exit status zero. The script writes a JSON report and compiler output under the ignored `solutions/v3/recon-output/` directory. It never reads browser cookies or calls a provider/challenge endpoint. Level 3 compilation here does **not** run the challenge's 25 hidden checks.

An explicit `--output` keeps disposable smoke-test files elsewhere:

```bash
npm run rehearse:v3 -- --output /tmp/cheetcode-rehearsal
```

Only pass `--run-dir`, individual session files, or `--level2-catalog` when you deliberately want to inspect trusted local data. Paths forwarded through an npm workspace are relative to that workspace; absolute paths remove ambiguity.

## Explore the implementation

Start with [V3's source tour](../solutions/v3/README.md#source-tour). Read one level end to end rather than every script at once. For Level 3, compare the [candidate matrix](candidates.md) with the [verification layers](testing.md#verification-layers).

You do not need to set up live access to understand the system. If you choose to inspect the historical live command surface, first read [command effects](commands.md), [configuration](configuration.md), and [security](../SECURITY.md).

## Troubleshooting

| Symptom | What to check |
|---|---|
| `cc` / `c++`: command not found | Install the C/C++ toolchain and rerun `npm run doctor`. Typechecking alone does not test native behavior. |
| `rustc`: command not found | Rust is needed for a full candidate sweep, not the default synthetic rehearsal. |
| Missing `tsx`, TypeScript, or Vitest | Run `npm ci` at the repository root. Avoid independent workspace lockfiles. |
| Rehearsal exits nonzero | Read the local report and compiler error. Check toolchain availability and whether custom fixtures were explicitly selected. |
| `level3:offline` asks for a session or provider | This is the historical challenge-offline repair loop, not the network-free demo. Use `rehearse:v3` for onboarding. |
| `.env` values appear wrong | npm workspace commands read that workspace's `.env`; already-exported shell values take precedence. See [configuration](configuration.md). |
| Public preflight cannot find a constant | The public shell may omit authenticated bundles, or the contract may have drifted. Do not interpret this as permission to start a session. |
| Local tests pass but a live finish fails | Local success does not reproduce server identity/integrity checks. Stop and inspect the actual failure; do not automatically retry. |

For a useful bug report, include the OS, Node version, exact command, workspace, and redacted error—not keys, cookies, fingerprints, or a raw run directory.

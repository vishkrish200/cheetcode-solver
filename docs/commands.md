# Command reference and side effects

[← Documentation](README.md) · [Configuration](configuration.md) · [Security](../SECURITY.md)

Start with the local commands. The presence of a script in `package.json` is not permission to operate an account, spend provider credits, or test another system. Historical live commands may no longer match the deployed challenge.

## Root commands

Run these from the repository root:

| Command | Scope | Effects |
|---|---|---|
| `npm ci` | Lockfile installation | Downloads dependencies; replaces the local dependency install. |
| `npm run doctor` | Local environment | Checks executable availability and dependencies; no tool execution, `.env` reads, or network. |
| `npm run check:docs` | Documentation | Validates local Markdown file/heading links; does not fetch external URLs. |
| `npm run typecheck` | Both versions | Strict TypeScript checks. |
| `npm test` | Repository + both versions | Local tests, including native compilation/execution. |
| `npm run test:repo` | Root utilities | Tests documentation checking and environment diagnostics. |
| `npm run check` | Aggregate | Documentation links, typechecks, and all tests. |
| `npm run test:v2` / `npm run test:v3` | One version | Version-specific local regression suite. |
| `npm run typecheck:v2` / `npm run typecheck:v3` | One version | Version-specific TypeScript check. |
| `npm run rehearse:v3` | Synthetic rehearsal | Network-free local smoke test; writes ignored output unless `--output` is provided. |
| `npm run preflight:v3 -- <url>` | Public contract | Fetches a public page and its script assets; no login or session start. This is a network command. |

`npm run rehearse:v3 -- --help` and `npm run preflight:v3 -- --help` show help without making a network request.

## Workspace syntax

Both workspaces expose version-local scripts. From the root, select one explicitly:

```bash
npm run level3:candidates:check --workspace @cheetcode-solutions/v3
npm run recon --workspace @cheetcode-solutions/v3 -- help
```

Replace `v3` with `v2` for shared historical commands. npm runs the script with the workspace as its working directory, so relative input paths and `.env` files are workspace-relative. Use absolute paths for private input artifacts when in doubt.

The `level2` and `level3` scripts already include the `run` subcommand. Do not append another `run`, and do not assume appending `help` cancels a hard-coded live subcommand. Use the documented dedicated preview/help entry points.

## Local workspace tools

| Script / recon subcommand | Versions | What it reads or does |
|---|---|---|
| `test`, `typecheck` | V2, V3 | Local tests or TypeScript checks. |
| `level3:candidates:check` | V2, V3 | Compiles all 24 reviewed candidate sources; writes temporary artifacts, not fixture files. Requires all three language toolchains. |
| `level3:components:preflight` | V2, V3 | Compiles selected candidates and runs the supported local semantic gates. Writes ignored run output. |
| `local:rehearsal` | V3 | Synthetic fixtures by default; explicit file overrides for trusted local data. No cookies/provider/challenge calls. |
| `level1:offline-check` | V3 | Reads the log selected by `LEVEL1_SESSION_LOG` and checks recognized JavaScript samples. Private logs remain private. |
| `level1:fingerprint` | V3 | Extracts sensitive fingerprint hints from an existing local network trace. No network; **omit the output path and it prints sensitive JSON to stdout**. |
| `recon -- analyze <run-dir>` | V2, V3 | Reads and summarizes local captures. Derived output still requires privacy review. |
| `recon -- help` | V2, V3 | Prints the recon command surface. |

Fingerprint extraction is not identity creation or authentication. Do not share the result or use another account's state. The artifact is excluded from public documentation and test fixtures.

## Challenge-offline is not network-free

`level3:offline` is a historical code-generation/repair loop against an existing saved session. It does not start or finish a challenge, but **it can call the selected model provider, transmit the prompt/source, and incur cost**. It can also compile and execute local verification code.

For an intentionally provider-assisted run, after reviewing configuration and data authorization:

```bash
npm run level3:offline --workspace @cheetcode-solutions/v3 -- /absolute/path/to/private/session.json
```

Without an argument it searches historical local Level 3 attempts; those are not shipped. This is why the newcomer demo is named `rehearse:v3`. Registered-candidate settings may avoid generation on a successful path but should not be treated as a universal no-provider guarantee for the repair loop.

## Public network and browser setup

| Command | Effects and boundary |
|---|---|
| `preflight:v3` / workspace `v3:preflight` | Public page/bundle fetch; contract drift or an incomplete public shell can fail it. No automatic authenticated fallback. |
| `install:browsers` | Downloads Playwright Chromium. Does not log in. |
| `recon -- auth` | Opens isolated Chromium, asks for manual OAuth, and writes sensitive storage/capture state. |
| `recon -- cold` | Opens the authenticated app and captures it without the deliberate orchestrate click. Page scripts can still make requests. |
| `recon -- sacrifice` | Clicks the challenge's orchestrate control and observes a timed run. Treat as account-mutating. |

Login is only one prerequisite. V3 direct Level 1 also requires browser-derived fingerprint hints matching the authorized session. The public snapshot intentionally does not import an everyday browser profile. Do not infer live readiness from a successful `auth` command.

## Authenticated or scored commands

These are reference entries, not a recommended batch to execute:

| Script | Versions | Behavior |
|---|---|---|
| `level1` | V2, V3 | Starts, solves, validates, and finishes Level 1; may use configured fallback logic. |
| `level1:llm` | V2, V3 | Level 1 with model use explicitly enabled. |
| `level2:preview`, `level3:preview` | V2, V3 | Authenticated preview interaction; not equivalent to a local read. |
| `level3:catalog` | V2, V3 | Repeated authenticated previews (default sample count is 12); not a local registry listing. |
| `level2`, `level3` | V2, V3 | Timed solve/validation/finish workflows; may use source search or providers. |
| `level2:speed-demon`, `level3:speed-demon` | V2, V3 | Fast scored paths with reduced work during the timer. They can affect attempt history. |
| `full:headful` | V2, V3 | Browser-driven multi-level solving and submission. |
| `level1:headful` | V3 | Browser-driven Level 1 path. |
| `zero-retry` | V2 | Historical whole-run orchestration policy; not a guarantee of outcome or no prior attempts. |

Before any live action, independently establish the current contract, authorized account, correct storage/fingerprint context, task/candidate compatibility, provider budget, and stop conditions. A rate limit, identity mismatch, unexpected score, or missing evidence is a reason to stop—not to launch an automatic retry campaign.

For historical outcomes rather than commands, read [V2](findings/v2-retrospective.md) and [V3](findings/v3-retrospective.md). For all optional settings, start with [configuration](configuration.md) and then inspect the relevant runner's source.

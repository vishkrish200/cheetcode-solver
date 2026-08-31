# Configuration and execution boundaries

Start with the offline path. A fresh checkout needs **no challenge login, `.env`, provider key, browser storage state, or cloud account** to run the tests and synthetic V3 rehearsal. Install the [local toolchain](toolchain.md#the-shipped-stack) first; the complete checks use native compilers as well as Node.

From the repository root:

```sh
npm ci
npm run doctor
npm run check
npm run rehearse:v3
```

`npm ci` downloads dependencies. The checks and synthetic rehearsal do not submit to the challenge or call a model provider. The rehearsal covers a small committed fixture set, not the full live challenge.

## Working directory matters

Each solution is an npm workspace. Running a script with `--workspace` makes that workspace the script's working directory. Relative `.env`, input, and output paths therefore resolve from the selected solution directory, not from the repository root.

| Invocation from the root | Script working directory | Default environment file |
|---|---|---|
| `npm run test:v2` | `solutions/v2` | No environment file is needed. |
| `npm run test:v3` | `solutions/v3` | No environment file is needed. |
| `npm run rehearse:v3` | `solutions/v3` | No environment file is needed. |
| `npm run recon --workspace @cheetcode-solutions/v3 -- help` | `solutions/v3` | `solutions/v3/.env` when a capture/live entrypoint loads configuration. |

Use the workspace scripts rather than invoking a nested entrypoint from an arbitrary directory. The Level 3 registry loader and candidate compile checker resolve their committed sources relative to their modules, but other commands intentionally resolve local artifacts from the working directory.

The examples are [V2 `.env.example`](../solutions/v2/.env.example) and [V3 `.env.example`](../solutions/v3/.env.example). If you later need an authorized live workflow, create the private `.env` beside the appropriate example. A root `.env` is not automatically shared with both workspaces.

### Loading and precedence

The small [environment loader](../solutions/v3/src/env.ts) reads `.env` from the process working directory. Capture configuration loads it before exporting target and storage paths, so import order does not silently freeze those settings before `.env` is read. [Regression tests](../solutions/v3/tests/recon-capture-env.test.ts) cover that bootstrap behavior.

An existing process environment value wins over the file, including an empty value. Use shell variables or your local secret manager for intentional overrides. The file parser accepts `NAME=value`, whole-line `#` comments, and single- or double-quoted values. It is not a shell: do not rely on `export`, variable interpolation, command substitution, or inline-comment processing.

## Challenge and artifact settings

These settings describe the retained runners. Supplying them is not permission to start a timed attempt.

| Variable | Default / requirement | Meaning |
|---|---|---|
| `CHEETCODE_URL` | Recorded challenge origin | Target base URL. The public V3 preflight also accepts an explicit URL argument. |
| `CHEETCODE_GITHUB` | Required by live solvers | Handle for the authenticated session. There is no personal-account fallback. Use the same identity as the session, not an unrelated handle. |
| `RECON_OUTPUT_DIR` | `recon-output` in the workspace | Directory for local captures and run artifacts; resolved to an absolute path at startup. |
| `AUTH_STORAGE_STATE_PATH` | `storage-state.json` inside the output directory | Private Playwright storage state. An explicit relative path resolves from the workspace. |
| `HEADED` | Unset | `1` makes the capture browser visible. The alternative `HEADLESS=0` also disables headless mode. |
| `RECON_HAR` | Unset | `1` requests a HAR in the authenticated capture context. Treat it as sensitive, even if some recorder fields are redacted. |
| `CHEETCODE_FINGERPRINT_HINTS_PATH` | Unset; V3 direct Level 1 gate | Private browser-derived fingerprint hints associated with the intended session. Not used by the historical V2 direct client. |

See [capture configuration](../solutions/v3/src/recon/capture.ts), [identity validation](../solutions/v3/src/identity.ts), and [artifact handling](artifacts.md). Captures can contain cookies, account details, page state, challenge text, and request bodies. Redaction helpers are not a guarantee that a whole run directory is safe to publish.

### V3 direct-client guardrail

The [V3 Level 1 API client](../solutions/v3/src/level1/api.ts) refuses to proceed without browser-derived fingerprint hints, unless the caller explicitly opts into its diagnostic synthetic fallback. That fallback is labeled known-invalid for the historical trusted-session path; it is not a fix, a browser impersonation recipe, or a supported way to obtain a score.

Even a readable hints file does not establish trust. The loader checks only a minimal shape, and a successful validation response does not guarantee a scored finish. Keep session identity, browser context, and provenance aligned; stop on an authentication wall, rate limit, or ambiguous score. Do not transplant a trusted browser session into another transport and assume equivalent behavior. The V2 client predates this guardrail and remains historical code, not a recommended V3 transport.

## Optional model configuration

No provider configuration is needed for the offline getting-started path. Configure these adapters only if you intend to run the optional model-backed workflow, have access to the selected provider, and are allowed to send it the relevant challenge material. Merely enabling an adapter can make fallback/repair paths issue paid requests.

Provider choice and model choice are separate. The default provider is `openai-compatible`; an API-key variable does **not** automatically select the matching vendor endpoint. Choose the provider and an accessible model explicitly.

### Shared and per-level controls

| Setting | Resolution |
|---|---|
| Provider | `LEVEL1_LLM_PROVIDER`, `LEVEL2_LLM_PROVIDER`, or `LEVEL3_LLM_PROVIDER` overrides `LLM_PROVIDER`. |
| Model | The corresponding `LEVELn_LLM_MODEL` has highest priority, followed by provider-specific overrides and the shared defaults described in [the toolchain](toolchain.md#frozen-defaults). |
| Compatible/Cerebras shared model | `LLM_MODEL` for Level 1; `SMART_LLM_MODEL` before `LLM_MODEL` for Level 2/3. |
| Endpoint | `LEVELn_LLM_BASE_URL` overrides the selected HTTP adapter's endpoint setting. `LLM_BASE_URL` is a compatible/Cerebras setting, not a universal override for all six adapters. |
| Fallback list | `LEVELn_LLM_FALLBACK_MODELS` overrides that adapter's shared comma-separated fallback list. Order is preserved and duplicates are removed. |

Here `LEVELn` means one of `LEVEL1`, `LEVEL2`, or `LEVEL3`, not a literal environment-variable prefix. These are historical resolver rules; always inspect [resolveModel / resolveLlmConfig](../solutions/v3/src/llm/client.ts) when adding an unusual combination. Unknown provider values fall back to `openai-compatible`, so check spelling rather than relying on configuration validation to catch mistakes.

### Provider-specific inputs

Only variable names are shown here. Store real keys and tokens privately, never in committed files or examples.

| Provider | Credentials / local authentication | Endpoint and model controls |
|---|---|---|
| `openai-compatible` | First available: `CEREBRAS_API_KEY`, `OPENAI_API_KEY`, `LLM_API_KEY` | `LLM_BASE_URL`, then `CEREBRAS_API_BASE`; explicit per-level model recommended. |
| `cerebras` | `CEREBRAS_API_KEY`, then `LLM_API_KEY` | `CEREBRAS_API_BASE`, then `LLM_BASE_URL`; `CEREBRAS_MODEL` is a shared fallback model setting. |
| `openai` | `OPENAI_API_KEY`, then `LLM_API_KEY` | `OPENAI_API_BASE`; `LEVELn_OPENAI_MODEL` or `OPENAI_MODEL`. |
| `anthropic` | `ANTHROPIC_API_KEY`, then `LLM_API_KEY` | `ANTHROPIC_API_BASE`; `LEVELn_ANTHROPIC_MODEL` or `ANTHROPIC_MODEL`. |
| `vertex` | Local `gcloud auth print-access-token`, or private `VERTEX_ACCESS_TOKEN` | `VERTEX_PROJECT` (also accepts `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT`), `VERTEX_LOCATION`, `LEVELn_VERTEX_MODEL` or `VERTEX_MODEL`. |
| `codex-cli` | Installed and authenticated local Codex CLI | `CODEX_CLI_BIN`, `LEVELn_CODEX_CLI_MODEL` or `CODEX_CLI_MODEL`; other subprocess controls live in the source. |

The Vertex and Codex CLI resolver paths bypass API-key checks; being considered configured does not prove the executable exists, the login is valid, or the chosen model is available. Provider URLs, default model strings, retries, and CLI flags are frozen implementation details. This repository does not certify their compatibility with a current external service.

## Commands with different risk boundaries

| Command family | What it can do |
|---|---|
| Root `check`, tests, typechecks, `rehearse:v3` | Local validation. No challenge credentials or model access are needed. |
| `level3:candidates:check` | Compile all 24 local sources; no network or account state. Writes compiler artifacts to a temporary directory. |
| `level3:components:preflight` | Local compile/semantic checks; writes a report to the ignored workspace output directory. |
| `preflight:v3` | Unauthenticated, read-only requests to public HTML and script bundles. It cannot certify an authenticated game contract if the public shell omits it. |
| `level3:offline` | Avoids challenge-server submission, **but may call a model provider** to generate or repair code. It also expects a local session artifact. It is not the credential-free synthetic rehearsal. |
| `recon`, previews, live/headful/speed runners | Browser or challenge-network interaction. Depending on the subcommand, they can capture private state, start attempts, validate, or finish a scored run. |

Do not infer safety from a command name alone. Read the selected workspace's [V2 scripts](../solutions/v2/package.json) or [V3 scripts](../solutions/v3/package.json) and entrypoint before running it. The two versions intentionally retain different behavior.

## Advanced tuning

The runners contain many experimental settings for time budgets, candidate selection, decomposition, validation, and retries. They are not all stable public options. Keep this guide focused on setup; use the code as the authority for advanced controls:

- [Level 1 runner](../solutions/v3/src/level1-runner.ts) and [client](../solutions/v3/src/level1/api.ts).
- [Level 2 runner](../solutions/v3/src/level2-runner.ts) and [source-search tools](../solutions/v3/src/level2/tools.ts).
- [Level 3 runner](../solutions/v3/src/level3-runner.ts), [run policy](../solutions/v3/src/level3/run-policy.ts), and [solver modes](../solutions/v3/src/level3/solver-mode.ts).
- [Model adapter](../solutions/v3/src/llm/client.ts) and [configuration tests](../solutions/v3/tests/llm-client.test.ts).

Changing a retry, validation, or timing flag can change live scoring behavior. Rehearse locally, document the intended change, and obtain fresh authorization before touching a live account.

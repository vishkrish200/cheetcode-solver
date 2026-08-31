# Toolchain, models, and attribution

This project combines deterministic solvers, source retrieval, model-assisted code generation, native compilers, and browser/API inspection. The important distinction is between **what the repository implements**, **what a historical attempt used**, and **what a fresh checkout can reproduce**.

For the solve sequence, read [the architecture](architecture.md). For setup, see [configuration](configuration.md). For source-level attribution, see [the candidate inventory](candidates.md).

## The shipped stack

The two workspaces have independent source and test trees but share the root npm lockfile. These are the versions resolved in that lockfile, not a recommendation to use the newest release of each tool.

| Component | Recorded version or requirement | Role in this repository |
|---|---|---|
| Node.js and npm workspaces | Node 22.12+ (22.x) or 24+; CI uses Node 22 | Run the TypeScript orchestration, native `fetch`, subprocesses, and local test harnesses. |
| TypeScript | 5.9.3 | Typed session, solver, validation, and result contracts; strict typechecking. |
| tsx | 4.22.2 | Run TypeScript entrypoints without a separate build step. |
| Playwright | 1.60.0 | Chromium-based authentication capture, page inspection, and headful runner support. Browser installation is separate from `npm ci`. |
| Vitest | 4.1.6 | Solver, protocol, parser, routing, compiler, and regression tests. |
| Node type definitions | 25.9.0 | Development-time typings; this is not the minimum Node runtime version. |
| C / C++ / Rust compilers | `cc`, `c++`, `rustc` on `PATH` | Compile Level 3 sources into shared libraries for local checks. |
| GitHub Actions | [CI workflow](../.github/workflows/ci.yml) | Run the documented installation, checks, rehearsal, and dependency audit. |

Dependency declarations live in the [V2 package](../solutions/v2/package.json), [V3 package](../solutions/v3/package.json), and [root lockfile](../package-lock.json). Compiler flags and timeouts are defined in [local-compile.ts](../solutions/v3/src/level3/local-compile.ts): C17, C++17, and Rust 2021, with warnings treated as errors. The tests execute native code; a Node-only machine is not sufficient for the full suite.

## What each layer contributes

| Layer | Approach | Start reading |
|---|---|---|
| Level 1 | Ninety-five registered deterministic solution factories in each snapshot, with example checks and an optional model fallback. A factory count is not coverage of every possible problem bank. | [V3 solutions](../solutions/v3/src/level1/solutions.ts), [solver tests](../solutions/v3/tests/level1-solver.test.ts) |
| Level 2 | Match a captured source-grounded catalog first; use repository code search and model-assisted interpretation for unresolved questions. | [Catalog](../solutions/v3/src/level2/catalog.ts), [tools](../solutions/v3/src/level2/tools.ts) |
| Level 3 | Route by task family and language; choose a registered candidate, deterministic template, specialist, or model-assisted decomposition; compile and apply the available verification gate. | [Candidate registry](../solutions/v3/src/level3/candidates.ts), [solver modes](../solutions/v3/src/level3/solver-mode.ts), [generation pipeline](../solutions/v3/src/level3/llm.ts) |
| Verification | Native compile checks, CPU and identity-resolver semantic harnesses, optional generated verifiers, and separate server feedback. | [Local verifier](../solutions/v3/src/level3/local-verify.ts), [coverage limits](candidates.md#what-the-local-checks-prove) |
| Observation | Browser capture plus typed API clients; V3 adds a public contract preflight and a synthetic offline rehearsal. | [Capture](../solutions/v3/src/recon/capture.ts), [preflight](../solutions/v3/src/ctf-v3-preflight.ts), [rehearsal](../solutions/v3/scripts/local-rehearsal.ts) |

The specialized skeleton-hole implementation is deliberately narrow: it supports the **Trait Expression AST in C**, filling two function bodies inside a fixed skeleton. It is not a universal decomposition engine for all 24 candidate variants. See [the implementation](../solutions/v3/src/level3/skeleton-decomposition.ts) and [tests](../solutions/v3/tests/level3-skeleton-decomposition.test.ts).

### Source search

The optional Level 2 search path invokes the GitHub CLI (`gh`) against four repository mappings: Chromium, Firefox's `gecko-dev`, LibreOffice `core`, and PostgreSQL. The mappings and evidence-to-answer flow are in [level2/tools.ts](../solutions/v3/src/level2/tools.ts). This path needs network access and an appropriately configured local CLI; it is not exercised by the synthetic rehearsal.

## Model adapters are capabilities, not a list of winning-run dependencies

Both snapshots implement six provider selections in [llm/client.ts](../solutions/v3/src/llm/client.ts):

| Provider selection | Implemented transport | Optional local setup |
|---|---|---|
| `openai-compatible` | Chat-completions HTTP requests; the recorded default endpoint is Cerebras. | Explicit endpoint, compatible model, and key. |
| `cerebras` | Chat-completions HTTP requests with Cerebras-specific configuration. | Cerebras key and model selection. |
| `openai` | Chat-completions HTTP requests with OpenAI-specific configuration. | OpenAI key and model selection. |
| `anthropic` | Messages HTTP requests with separate system text and message-body conversion. | Anthropic key and model selection. |
| `vertex` | Google Vertex `generateContent` HTTP requests. | Cloud project and local `gcloud` authentication or a supplied access token. |
| `codex-cli` | Non-interactive local Codex CLI subprocess, requesting a final structured response. | Installed, authenticated Codex CLI. |

This table documents the code, not current provider availability, supported account plans, API compatibility, or an endorsement. Adapter tests use controlled responses/configuration; they do not prove a paid provider request succeeds today. The optional paths can send challenge text or code to a provider and incur charges. Review the target's rules and your data-sharing permissions first.

The concrete model attribution retained in the repository is the Level 3 registry's `source: "gpt-5.5"` metadata. It labels 21 V2 sources and 18 V3 sources. The remaining sources are tagged `manual`; in V3 that includes three repaired forks of model-assisted attestation candidates. Those labels do not establish which API transport generated a file, nor that every model listed below participated in a successful timed run.

### Frozen defaults

The following strings are preserved for historical reproducibility in the adapter. They are **not current model recommendations** and are not guaranteed to resolve at any provider.

| Configuration path | Recorded default |
|---|---|
| Fast / Level 1 | `gpt-oss-120b` |
| Shared smart / Level 2 and Level 3 | `qwen-3-235b-a22b-instruct-2507` |
| Smart fallback list for compatible/Cerebras paths | `zai-glm-4.7`, then `gpt-oss-120b` |
| Vertex | `gemini-3.5-flash` |
| Codex CLI | `gpt-5.5` |

OpenAI and Anthropic selections do not translate the shared defaults into provider-specific model names. Set a model explicitly when choosing either adapter. See [provider configuration](configuration.md#optional-model-configuration) and [resolver tests](../solutions/v3/tests/llm-client.test.ts).

## Historical operational tooling

The original investigations were broader than the maintained command surface:

- Codex-assisted development and model-generated candidates were combined with manual inspection, repair, and regression tests.
- Chrome/Chromium, Comet, and Safari appeared in browser-context investigations. The final V3 recovery depended on the trusted Safari session; the shipped Playwright runner launches Chromium and does **not** reproduce that Safari environment.
- HAR captures, `curl`, and Node HTTP/2 timing probes were used to separate payload correctness, session behavior, network latency, and server-reported elapsed time.
- A cloud VM with a native build toolchain was used for co-location and latency experiments. It is not a required dependency, a shipped deployment target, or a resource this repository creates.

One-off cookie, fingerprint, timing, and bonus probes were removed from the supported package. Their lessons are preserved in the [V2 retrospective](findings/v2-retrospective.md), [V3 retrospective](findings/v3-retrospective.md), and [failure analysis](findings/failure-analysis.md). Raw browser and account artifacts remain private under the [artifact policy](artifacts.md).

## Credits and licensing boundaries

CheetCode / Firecrawl supplied the challenge that motivated this independent solution study. The open-source language runtimes, compilers, libraries, and source repositories above made the local tooling possible. This repository is not an official challenge implementation and does not imply endorsement by those projects or model providers.

Original project code and documentation are offered under the [MIT license](../LICENSE). Dependencies retain their own licenses. Naming a challenge, preserving a task interface, or labeling a source as model-assisted does not grant rights to third-party challenge text, starter code, captured application bundles, screenshots, or provider output. Review provenance and applicable terms before redistributing additional material; do not assume the root license relicenses someone else's work.

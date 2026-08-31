# V2 Level 3 candidate sources

The historical V2 registry contains 24 reviewed candidate sources: eight task families in C, C++, and Rust. Its provenance labels record 21 model-assisted (`gpt-5.5`) sources and three `manual` CPU-emulator sources. Twelve entries carry a historical server-verification flag; twelve do not.

These are solution implementations promoted from the research workflow, **not synthetic challenge fixtures**. They are committed so the loader and local checks do not depend on private run directories. Raw server proof payloads, prompts, browser state, and account artifacts are not distributed.

Read the shared [candidate matrix and verification limits](../../../../docs/candidates.md) before interpreting a status flag. The [V2 registry](../../src/level3/candidates.ts) is the source of truth for this snapshot; the [V3 tree](../../../v3/fixtures/level3-candidates) contains later repairs without changing the V2 historical files.

From the repository root, compile this registry locally with:

```sh
npm run level3:candidates:check --workspace @cheetcode-solutions/v2
```

Compilation is not semantic verification or current server certification. See [toolchain and attribution](../../../../docs/toolchain.md) and the [artifact policy](../../../../docs/artifacts.md) before reusing or adding sources.

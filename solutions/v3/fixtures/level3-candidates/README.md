# V3 Level 3 candidate sources

The V3 registry contains 24 reviewed candidate sources: eight task families in C, C++, and Rust. Its provenance labels record 18 model-assisted (`gpt-5.5`) sources and six `manual` sources. The latter include the three CPU implementations and three repaired forks of model-assisted attestation candidates; `manual` does not mean every line was written without assistance.

Twelve entries carry a historical server-verification flag and twelve do not. The repaired attestation sources remain unverified. These flags preserve prior evidence; they are not a fresh certification of every source against V3 or the current challenge deployment.

These files are solution implementations promoted from the research workflow, **not synthetic challenge inputs**. The separate [rehearsal fixtures](../rehearsal) are synthetic. Raw server proof payloads, prompts, browser state, and account artifacts are not distributed.

Read the shared [candidate matrix and verification limits](../../../../docs/candidates.md). The [V3 registry](../../src/level3/candidates.ts) records exact source paths and provenance; the [V2 tree](../../../v2/fixtures/level3-candidates) preserves the earlier snapshot for comparison.

From the repository root, compile this registry locally with:

```sh
npm run level3:candidates:check --workspace @cheetcode-solutions/v3
```

Compilation is not semantic verification or current server certification. See [toolchain and attribution](../../../../docs/toolchain.md) and the [artifact policy](../../../../docs/artifacts.md) before reusing or adding sources.

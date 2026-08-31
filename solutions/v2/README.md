# V2 · the historical solver

[← Repository](../../README.md) · [V2 retrospective](../../docs/findings/v2-retrospective.md) · [Compare V3](../v3/README.md)

This workspace preserves the May 2026 implementation derived from commit `6fb8c76`. It is a curated research snapshot, not a byte-for-byte checkout: private/tactical probes were removed, candidate source was made self-contained, and packaging/security fixes may still be applied.

**Historical result:** 60/60 solved; 1,370 + 1,050 + 1,530 = **3,950**. This is reconstructed from private records, not reproduced by the local test suite.

## Run the local checks

Install once at the repository root, then select the workspace:

```bash
npm ci
npm run test:v2
npm run typecheck:v2
```

Native tests require `cc` and `c++`. A complete candidate compilation sweep also needs `rustc`:

```bash
npm run level3:candidates:check --workspace @cheetcode-solutions/v2
```

No browser, account, or provider credentials are required for these checks. They compile/run trusted local source; use an isolated environment for unfamiliar code. [Full setup guide](../../docs/getting-started.md)

## Source tour

| Start here | What to look for |
|---|---|
| [Level 1 factories](src/level1/solutions.ts) and [runner](src/level1-runner.ts) | Current-signature specialization instead of stale session answers. |
| [Level 2 catalog](src/level2/catalog.ts) and [tools](src/level2/tools.ts) | Evidence extraction, normalized matching, and repository search. |
| [Level 3 registry](src/level3/candidates.ts) and [templates](src/level3/templates/index.ts) | Candidate provenance and family/language routing. |
| [Local verification](src/level3/local-verify.ts) and [repair policy](src/level3/run-policy.ts) | Compile versus semantic evidence, focused repair, and stopping rules. |
| [Full headful runner](src/full-headful-runner.ts) | The historical browser-driven multi-level flow. |
| [Zero-retry runner](src/zero-retry-runner.ts) | V2-specific orchestration policy—not a claim of one total research attempt. |
| [Tests](tests) | Executable examples of the preserved contracts. |

V2 retains 95 Level 1 factories and 24 Level 3 candidates across eight families. Twelve candidates have historical server-verification annotations; the rest are not server-verified. [Matrix and provenance](../../docs/candidates.md)

## Historical live tooling

The workspace still contains API/UI runners for research inspection. Their endpoint names, bonus behavior, timers, and authentication assumptions may no longer match the service. Do not run V2 against a later deployment by assuming compatibility.

Read the [command side-effect reference](../../docs/commands.md) and [configuration](../../docs/configuration.md) before choosing any live command. In particular, `level3:offline` can use a paid model provider despite not contacting the challenge server, and `recon -- sacrifice` can start a timed run.

V2 behavior changes should remain exceptional. Prefer documentation, reproducibility, or security fixes here and new research work in the newer snapshot. [Contribution policy](../../CONTRIBUTING.md#version-policy)

# V3 · the primary research implementation

[← Repository](../../README.md) · [V3 retrospective](../../docs/findings/v3-retrospective.md) · [Compare V2](../v2/README.md)

This workspace preserves the August 2026 V3 work: contract preflight, explicit session identity, specialized solvers, native candidates and verification, and a small synthetic rehearsal. It is the primary reading path, not a continuously supported live service.

**Historical result:** 60/60 solved; 1,270 + 1,050 + 1,530 = **3,850**. The final Level 3 Lua Bytecode VM C++ run received full correctness and speed points. The account-specific captures remain private; see the [evidence ledger](../../docs/findings/evidence.md).

## Start with the public local path

From the repository root:

```bash
npm ci
npm run doctor
npm run test:v3
npm run typecheck:v3
npm run rehearse:v3
```

No `.env`, account, browser installation, or API key is needed. The rehearsal always starts from committed synthetic inputs unless explicit file overrides are supplied. It checks one Level 1 example, one Level 2 catalog match, and one C++ compilation—not a 60-item challenge replay.

Native tests require `cc` and `c++`; the all-language registry check also needs `rustc`. [Setup and troubleshooting](../../docs/getting-started.md)

## Source tour

| Component | Entry point | Companion tests |
|---|---|---|
| Level 1 specialization | [solutions](src/level1/solutions.ts), [runner](src/level1-runner.ts) | [solver](tests/level1-solver.test.ts), [V3 catalog](tests/level1-v3-catalog.test.ts) |
| Level 1 session contract | [client](src/level1/api.ts), [identity](src/identity.ts) | [API](tests/level1-api.test.ts) |
| Level 2 retrieval | [catalog](src/level2/catalog.ts), [tools](src/level2/tools.ts), [runner](src/level2-runner.ts) | [catalog](tests/level2-catalog.test.ts), [tools](tests/level2-tools.test.ts) |
| Level 3 routing and repair | [runner](src/level3-runner.ts), [policy](src/level3/run-policy.ts) | [policy](tests/level3-run-policy.test.ts) |
| Native source | [registry](src/level3/candidates.ts), [fixtures](fixtures/level3-candidates) | [candidates](tests/level3-candidates.test.ts) |
| Native verification | [local verifier](src/level3/local-verify.ts), [components](src/level3/component-preflight.ts) | [verification](tests/level3-local-verify.test.ts), [components](tests/level3-component-preflight.test.ts) |
| Model adapters | [provider client](src/llm/client.ts) | [client](tests/llm-client.test.ts) |
| Contract drift | [preflight](src/ctf-v3-preflight.ts) | [preflight](tests/ctf-v3-preflight.test.ts) |
| Credential-free demo | [rehearsal](scripts/local-rehearsal.ts), [fixtures](fixtures/rehearsal) | [rehearsal](tests/local-rehearsal.test.ts) |

Follow the [architecture guide](../../docs/architecture.md) for the full flow, or the [candidate matrix](../../docs/candidates.md) for family/language coverage.

## Public preflight is a separate network action

```bash
npm run preflight:v3 -- --help
```

To deliberately inspect a public target, `npm run preflight:v3 -- <url>` fetches its page and referenced scripts without logging in or starting a session. A missing constant can mean drift or that the public shell does not include the authenticated game bundle. The command does not automatically escalate to login or a live attempt.

## Before any historical live workflow

Read [command effects](../../docs/commands.md), [configuration](../../docs/configuration.md), and [security](../../SECURITY.md). Important boundaries:

- `CHEETCODE_GITHUB` must be explicit and match the authorized browser identity.
- Saving storage state through manual OAuth does not by itself satisfy the V3 direct client's fingerprint requirements.
- Capture output is private by default; redaction helpers are not publication guarantees.
- `level3:offline` may call model providers and execute native verification code.
- Semantic checks are opt-in in the normal Level 3 runner; inspect actual coverage.
- Speed mode defaults to historically server-verified candidates, which are not fresh current-service certifications.
- A rate limit, identity mismatch, or unexpected score warrants a stop and diagnosis, not an automatic retry.

The [retrospective](../../docs/findings/v3-retrospective.md) explains the failures behind these rules.

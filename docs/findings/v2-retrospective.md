# V2 retrospective

Status: historical reconstruction from May 2026. The underlying authenticated captures remain private.

## Result

| Level | Score |
|---|---:|
| Level 1 | 1,370 |
| Level 2 | 1,050 |
| Level 3 | 1,530 |
| Total | 3,950 |

The reconstructed final state was 60/60 solved. All confirmed trickery points came from Level 1: `speed_demon` (+100), `flag_finder` (+150), and `header_hack` (+100). A separate victory/contact form accepted a flag-shaped value but did not change ELO.

## What worked

- Re-solve the current Level 1 bank; a static answer catalog became stale across runs.
- Use the extracted application catalog for Level 2, then source/tool retrieval, then a model only for unresolved items.
- Preview Level 3 before starting the timer, route by task family and language, compile locally, and prefer server-proven candidates.
- Validate the exact payload that will be finished. Report named exploit responses and score deltas rather than inferring bonuses from UI copy.

## What failed

- An early static Level 1 catalog produced 0/25 after the problem bank changed.
- A first primary-account finish scored 24/25 and affected retry state; local examples had not been a sufficient release gate.
- Compiling Level 3 code did not prove ABI or semantic correctness.
- API-started Level 3 sessions did not automatically render the browser challenge.
- L2/L3 speed tricks, negative elapsed values, validation reordering, over-answering, fingerprint changes, polyglot submissions, and ordinary lead-form guesses did not explain the missing score.

## Reuse rule

Treat every V2 endpoint, score constant, flag, header, task family, and timing threshold as historical. V3 required a fresh contract audit rather than a replay of V2 assumptions.

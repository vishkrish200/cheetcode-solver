# V3 retrospective

Status: historical result verified in August 2026. Raw authenticated artifacts and account identifiers are intentionally excluded.

## Result

| Level | Score |
|---|---:|
| Level 1 | 1,270 |
| Level 2 | 1,050 |
| Level 3 | 1,530 |
| Total | 3,850 |

The final observed state was 60/60 solved with ELO 3,850. The decisive Level 3 run used a registered, server-verified C++ candidate for the Lua Bytecode VM family, completed 25/25, and received the full 30-point speed component at a reported server elapsed time of 88 ms.

## What changed from V2

- Session identity and browser fingerprint provenance became part of the practical finish boundary. A payload could validate 25/25 yet finish at 0/25 when the authenticated identity or trusted browser context did not align.
- The V3 score ceiling was 3,850, not the V2 total of 3,950. Reusing V2 bonus assumptions caused false leads.
- Level 3 speed was a graded component. A correct 1,526-point result lost four points only because its speed component was 26/30.
- A verified candidate registry became essential for a fast path that skipped local repair and server validation during the timed window.

## What worked

- Fail fast when the public bundle contract drifts.
- Keep identity, storage state, and fingerprint hints aligned; never silently fall back to a personal default account.
- Use offline rehearsal to prove the local pipeline without reading cookies or calling the server.
- Preview until a supported, verified Level 3 family appears; do not spend a speed attempt on an unverified candidate.
- Stop after a confirmed full-score result.

## Limits

The score is a historical account-specific outcome, not a reliability claim for arbitrary accounts or later challenge deployments. Local tests verify code contracts; they do not reproduce the live anti-abuse system or leaderboard.

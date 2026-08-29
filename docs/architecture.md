# Architecture

## Version boundary

V2 and V3 are independent npm workspaces. Each owns its source, tests, TypeScript configuration, and command surface. Code is intentionally duplicated at the version boundary: the challenge contract changed, and sharing network adapters would make the historical implementation look more compatible than it is.

V2 is frozen for comparison. V3 is the maintained snapshot.

## Solver flow

```text
public contract preflight
          |
authorized capture -> redacted recon summary
          |
     session payload
      /    |     \
 Level 1 Level 2 Level 3
 rules    catalog  candidate/template/LLM
      \    |     /
 local examples + compile + semantic gates
          |
 optional server validation
          |
       one finish
          |
 redacted local artifact (ignored by Git)
```

Level 1 favors deterministic specialists because the timer penalizes generation latency. Level 2 uses a source-grounded catalog before tools or a model. Level 3 routes by task family and language, then compiles and verifies candidates before submission.

## Trust boundaries

- Tests and `local:rehearsal` are offline evidence.
- Public preflight is read-only network evidence.
- Authentication proves only that a local session exists.
- A validate response is not equivalent to a scored finish.
- A scored finish is not equivalent to a durable leaderboard result.
- Historical score screenshots and private captures are not current-service claims.

## Why the probes were removed

The working repository accumulated single-use timing, flag, cookie, fingerprint, and scoreboard probes. They were valuable during diagnosis but obscured the supported path, embedded account-specific assumptions, and made strict typechecking fail. The cleanup keeps the reusable solver and verification layers; the durable conclusions live in `docs/findings`.

# CheetCode v3 plan

## Scope and safety gates

- Laboratory account: Comet profile `ctf`, CTF identity `@trimax-eng`.
- Primary account: out of scope until the release gate is explicitly green.
- Code isolation: branch `codex/ctf-v3-recon`, worktree `/Users/vishnukrishnan/Documents/cheetcode-solver-ctf-v3`.
- Never click Orchestrate during cold reconnaissance.
- Treat v2 tricks, scores, and challenge-family assumptions as hypotheses until v3 evidence confirms them.

## Execution phases

1. Cold capture of the dashboard, profile, public bundles, routes, and prestart behavior.
2. Analyze the v3 session/preview/validation/finish contracts and compare them with the existing runner.
3. Run one bounded fake-account orchestration and archive every timed request, response, challenge, and score.
4. Build deterministic fast paths: cached specialists for L1, catalog lookup for L2, and locally verified registered candidates/templates for L3.
5. Validate locally and, where required, against the fake account. No primary-account experimentation.
6. Freeze the exact code/configuration and run the primary submission only after the fake-account gates pass.

## Release gates

- L1: 25/25 correct with a no-LLM timed path.
- L2: 10/10 correct from a complete extracted catalog or equivalent deterministic source.
- L3: 25/25 correct with each selected candidate locally compiled and semantically checked.
- No unresolved repair loop, missing catalog entry, unverified candidate, or unexplained score behavior.
- The final path must be reproducible from a clean checkout and must not require live exploration during the timer.

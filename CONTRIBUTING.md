# Contributing

Keep changes version-specific. V2 is historical; behavior changes belong in V3 unless they repair a reproducibility or security problem in the V2 snapshot.

Before opening a change:

1. Add or update tests in the affected workspace.
2. Run `npm run check` from the repository root.
3. Run a staged secret scan.
4. Keep live-server evidence separate from offline test evidence.
5. Do not add raw captures; summarize redacted findings under `docs/findings`.

Live challenge runs, account actions, provider spending, and public deployment require separate explicit authorization. A green local suite is not authorization for any of those actions.

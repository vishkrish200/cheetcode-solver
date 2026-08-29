# CheetCode v3 primary release checklist

Status: **ready for explicit primary-account authorization; primary account has not been opened.**

## Frozen submission package

- Level 1: deterministic catalog, fake gate `25/25`.
- Level 2: deterministic commit catalog, fake gate `10/10`.
- Level 3: Rust 16-bit CPU Emulator source at `recon-output/2026-08-26T01-42-00-fake-l3-success/submitted.rs`.
- Level 3 SHA-256: `bbe919a767b7e0b07b442489e14515a96ceba448f738b1998b3e73fa812a5525`.
- Last local verification: full suite `152/152`, TypeScript typecheck, and clean diff check.

## Primary run gate

1. Show the active Comet profile and authenticated identity before touching Orchestrate.
2. Confirm it is the intended primary account, not `ctf` / `trimax-eng`.
3. Capture only the fresh Level 2 and Level 3 previews; do not start a timer while previewing.
4. Proceed only if the assigned Level 3 task remains `16-bit CPU Emulator` in Rust and its session exposes 25 checks. If it differs, stop and return to local analysis.
5. Re-run the frozen Level 3 source local compile + semantic harness before the live Level 3 start.
6. For each level, validate first and finish only on an exact complete pass. Preserve the preview, session, submitted source, validation summary, and finish response.
7. Do not retry, substitute a candidate, or use a UI panel as authoritative when the named API response disagrees. Record the discrepancy and stop.

## Explicit exclusions

- No cookie, local-storage, profile-store, or credential export.
- No primary-account action until the profile/identity proof and direct authorization are both present.

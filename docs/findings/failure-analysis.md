# Failure analysis

## Challenge failures

### Validation passed but finish scored zero

The client initially treated a 25/25 validation response as proof that the finish would score. V3 showed that finish had additional identity and integrity checks. The fix was to model validation and finish as distinct contracts and keep account, session, cookie, and fingerprint provenance aligned.

### Static solutions drifted

Level 1 banks changed across sessions. A static catalog that once worked later returned 0/25. The durable approach is deterministic family specialists plus sample execution and a fallback only for unknown problems.

### Local compilation was over-trusted

Level 3 candidates could compile and still fail ABI, semantic, or scale behavior. The release gate now separates compile, local semantic harnesses, optional server validation, and scored finish evidence.

### Unverified speed candidates wasted attempts

An unverified Rust candidate failed all 25 checks during a speed retry. The successful retry waited for a family with a registered, server-verified candidate. Fast mode is now gated on verified candidates by default.

### Latency was misdiagnosed as correctness loss

A 1,526-point Level 3 result was fully correct. The four-point gap was entirely the speed component (26/30). Component-level score accounting avoided unnecessary solver changes.

### V2 bonus theories leaked into V3

The team initially looked for a V2-style missing bonus. V3 used a different ceiling and scoring model. Version-specific retrospectives and separate code trees now prevent that cross-version assumption.

## Repository failures

### Version boundaries were implicit

V2 and V3 changes shared one root source tree, so historical code, current code, and tactical probes appeared equally supported. They now live in independent workspaces with explicit status labels.

### Investigative scripts became product surface

Single-use cookie, flag, timing, fingerprint, and scoreboard probes accumulated in `src` and `package.json`. Several failed strict TypeScript checks even though the unit suite passed. The cleanup removed those entry points, retained the reusable verification code, and documented their conclusions here.

### Private operational notes were mixed with public documentation

The prior docs contained local paths, browser-profile names, account handles, session identifiers, and instructions for moving live cookies. Those notes were replaced with redacted findings and a strict artifact policy.

### Generated output dominated the workspace

Hundreds of megabytes of ignored captures, compiler output, browser snapshots, and orchestration logs made the repository difficult to audit. They were moved to a private sibling archive; Git keeps only concise derived evidence.

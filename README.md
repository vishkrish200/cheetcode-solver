# CheetCode Solver

Recon-first harness for the Firecrawl CheetCode CTF.

## Commands

```bash
npm install
npm run install:browsers
npm run recon -- auth
# or, if Comet is already logged in:
npm run recon -- auth:comet
npm run recon -- cold
npm run recon -- analyze
npm run recon -- sacrifice
```

`auth` opens a headed browser and saves `recon-output/storage-state.json` after manual GitHub OAuth. `cold` captures the authenticated app without starting the timer. `sacrifice` clicks the orchestrate button and records the timed run. `analyze` summarizes captured network traffic into endpoint hints.

## Level 1 Attempt

```bash
npm run recon -- auth:comet
npm run level1
```

The Level 1 runner starts a fresh session through the captured API contract, solves the returned batch with deterministic specialists, validates against provided examples, and submits once.

For dynamic problem banks beyond the specialist catalog, export an OpenAI-compatible key first:

```bash
export CEREBRAS_API_KEY=...
export LLM_MODEL=gpt-oss-120b
export SMART_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
npm run level1
```

## Solver Policy

Level 1 is cache/rule first and uses the LLM only for unknown or sample-failing problems. Level 2 and Level 3 are dynamic-first: they extract the live session payload, ask the stronger model, validate, and feed failures back into a repair attempt.

Useful model knobs:

```bash
LEVEL1_LLM_MODEL=gpt-oss-120b
SMART_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
LEVEL2_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
LEVEL3_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
```

Level 2 supports `LEVEL2_SOLVER_MODE=dynamic|hybrid|catalog`; default is `dynamic`. `hybrid` uses the old catalog as an accelerator and asks the model for misses/repairs. Level 3 supports `LEVEL3_SOLVER_MODE=dynamic|hybrid|specialist|candidate`; local `.env` defaults to `hybrid`, which tries registered GPT-5.5/task-family candidates first, then specialists, then live synthesis.

Before spending a live Level 3 timer, use the offline compiler loop on saved payloads:

```bash
npm run level3:offline
npm run level3:offline -- recon-output/<timestamp>-level3-attempt
```

This does not call the CTF server. It only asks the model for code, compiles locally with strict flags, feeds compiler errors back, and writes artifacts under `recon-output/*-level3-offline`.

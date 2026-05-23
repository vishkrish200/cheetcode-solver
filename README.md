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

Level 1 is cache/rule first and uses the LLM only for unknown or sample-failing problems. Level 2 is tool-first: it answers from the extracted site catalog, can search GitHub source for catalog misses, and only then falls back to the LLM. Level 3 is dynamic/hybrid: it extracts the live session payload, compiles locally, validates on the server, and feeds failures back into repair attempts.

Useful model knobs:

```bash
LEVEL1_LLM_MODEL=gpt-oss-120b
SMART_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
LEVEL2_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
LEVEL3_LLM_MODEL=qwen-3-235b-a22b-instruct-2507
```

Level 2 supports `LEVEL2_SOLVER_MODE=dynamic|hybrid|catalog|tools`; default is `hybrid`. `hybrid` uses the extracted catalog first, optionally searches GitHub source for misses with `LEVEL2_SOURCE_SEARCH=1`, and asks the model only for remaining misses. `tools` disables the final LLM fallback. Level 3 supports `LEVEL3_SOLVER_MODE=dynamic|hybrid|specialist|candidate`; local `.env` defaults to `hybrid`, which tries registered GPT-5.5/task-family candidates first, then specialists, then live synthesis. The default `npm run level3` path enables registered components and `LEVEL3_SKELETON_HOLES=1`, so supported non-component families can use locked skeletons with small per-hole workers before falling back to freeform synthesis.

Before spending a live Level 3 timer, use the offline compiler loop on saved payloads:

```bash
npm run level3:offline
npm run level3:offline -- recon-output/<timestamp>-level3-attempt
```

This does not call the CTF server. It only asks the model for code, compiles locally with strict flags, feeds compiler errors back, and writes artifacts under `recon-output/*-level3-offline`.

## SPEED DEMON Mode

The CTF server awards a `+100` trickery bonus on a level when the entire `startSession → finishSession` round-trip clears the server in under one second with all problems correct (server message: `⚡ SPEED DEMON — You submitted in under 1 second with working solutions.`). The default Level 1 path already triggers it because solutions are looked up synchronously; Level 2 and Level 3 do not, because the default pipelines call validate, tools, and/or LLM in between.

To target SPEED DEMON on Level 2 and Level 3:

```bash
npm run level2:speed-demon   # catalog-only, no validate, no tools, no LLM
npm run level3:speed-demon   # registered verified candidate, no local-verify, no server-validate, no repair
```

Notes:
- `level2:speed-demon` throws if the catalog is missing any drawn problem. Confirm `recon-output/*/chunks` has a recent Level 2 catalog before running.
- `level3:speed-demon` throws if no verified candidate is registered for the drawn `(taskName, language)`. Add `LEVEL3_SPEED_DEMON_ALLOW_UNVERIFIED=1` to allow unverified candidates (risk: a non-correct submission misses both correctness base and the bonus).
- Both modes write a `metadata.json` that reports `submitToFinishMs` (locally observed) and `serverTimeElapsedMs` (sent in the finish body). The actual server-side elapsed is the one that gates SPEED DEMON.

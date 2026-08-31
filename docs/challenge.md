# The challenge

[← Documentation](README.md) · [Next: architecture →](architecture.md)

CheetCode mixed three kinds of work under a short shared experience: algorithmic implementation, finding facts in source code, and building a small native system. The engineering challenge was not simply to generate code quickly. It was to spend time on the right work, preserve session state, and understand exactly what the server had graded.

## Recorded format

The V3 public contract expected by [the preflight](../solutions/v3/src/ctf-v3-preflight.ts) records 60 scored items and 240 seconds:

| Level | Recorded allocation | Shape | Important distinction |
|---|---|---|---|
| 1 | 25 problems · 60 seconds | JavaScript function signatures, statements, and examples. | Recognizing a family does not prove every sample or hidden case passes. |
| 2 | 10 questions · 60 seconds | Questions grounded in open-source repositories. | A plausible answer is weaker evidence than a matched catalog entry or source snippet. |
| 3 | 25 checks · 120 seconds | One systems task in C, C++, or Rust. | The checks grade a single implementation, including behavior beyond compilation. |

These are snapshot facts. A changed title, bundle, route, timer, or task schema requires a new contract audit; these docs do not establish the current live rules. The V2 run also reported 60/60, but V2-specific scoring must not be inferred from the V3 preflight.

## The solving strategy

Preparation moved repeatable work out of the timed path:

1. Identify the payload schema, public function boundary, and expected answer shape.
2. Prefer a deterministic solver, a source-grounded answer, or a known candidate.
3. Use model generation where an actual gap remains.
4. Apply the checks appropriate to the artifact: examples, compiler, ABI, semantics, or server feedback.
5. Submit only in the separately authorized live workflow, then inspect the actual scored result.

The system is therefore a set of specialized pipelines, not one prompt that solves everything. [Architecture](architecture.md) connects each stage to its implementation.

## V2 versus V3

| Dimension | V2 | V3 |
|---|---|---|
| Snapshot | May 2026 | August 2026 |
| Preserved implementation | [Historical workspace](../solutions/v2/README.md) | [Primary research workspace](../solutions/v3/README.md) |
| Historical final total | 3,950 | 3,850 |
| Main lesson | Dynamic banks and layered correctness checks mattered more than static answers. | A validated payload, a trusted session, and a scored finish are separate boundaries. |
| Distinctive retained tooling | Zero-retry orchestration. | Public contract preflight, fingerprint handling, and synthetic local rehearsal. |

“Zero retry” describes an orchestration policy. It is not evidence that the entire research effort used one attempt. Likewise, “speed-demon” names a timed execution mode; it is not a correctness guarantee.

## A short glossary

| Term | Meaning in this repository |
|---|---|
| Preview | Inspect an upcoming task/family before a run. It is still a server interaction in live tooling. |
| Candidate | A source implementation for a Level 3 family/language pair. It may be generated, repaired, unverified, or historically server-verified. |
| Template | A deterministic implementation builder for a supported task family. |
| Local verification | Compile and optionally execute a local harness. Read the result's actual coverage, not only its top-level success flag. |
| Validate | Ask the challenge server to evaluate a payload. Not the same as finishing or receiving a score. |
| Finish | Submit the final payload and receive the scored outcome, potentially affecting account history. |
| Leaderboard verification | Observe a persisted account-level outcome after finishing. Private historical observations are not reproduced by tests. |
| Speed component | A portion of the score dependent on server-measured elapsed time. Full correctness need not earn maximum speed points. |

Continue with the [V2 story](findings/v2-retrospective.md), [V3 story](findings/v3-retrospective.md), or the [safe local path](getting-started.md).

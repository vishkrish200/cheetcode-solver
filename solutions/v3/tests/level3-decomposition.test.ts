import { afterEach, describe, expect, it } from "vitest";

import {
  buildLevel3FunctionWorkerLlmRequest,
  buildLevel3LockedDataModelLlmRequest,
  composeLevel3DecomposedSource,
  estimateLevel3FunctionClusterComplexity,
  extractLevel3FunctionWorkerResultFromModelContent,
  extractLevel3LockedDataModelFromModelContent,
  shouldUseLevel3FunctionDecomposition,
  solveLevel3WithFunctionDecompositionDetailed,
  type Level3LockedDataModel
} from "../src/level3/decomposition.js";
import type { Level3Challenge } from "../src/level3/types.js";

const savedEnv = { ...process.env };

describe("Level 3 function decomposition", () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("builds a locked data-model request before asking workers for code", () => {
    const request = buildLevel3LockedDataModelLlmRequest(cpuRustChallenge());
    const payload = JSON.parse(request.messages[1]?.content ?? "{}");

    expect(request.messages[0]?.content).toContain("locked physical data model");
    expect(request.messages[0]?.content).toContain("Do not implement exported functions");
    expect(request.messages[0]?.content).toContain("under 2200 characters");
    expect(request.messages[0]?.content).toContain("Do not put assembler");
    expect(request.messages[0]?.content).toContain("Rust preambles");
    expect(request.messages[0]?.content).toContain("sharedContract must include cross-worker semantic invariants");
    expect(request.messages[0]?.content).toContain("do not recursively lock the same Mutex");
    expect(request.messages[0]?.content).toContain("Preamble helpers that may be called from execution loops must not lock");
    expect(request.messages[0]?.content).toContain("crate root");
    expect(request.responseFormat).toEqual({ type: "json_object" });
    expect(payload.extractedExports.map((entry: { name: string }) => entry.name)).toEqual([
      "cpu_reset",
      "cpu_load_word",
      "cpu_run"
    ]);
    expect(payload.familySemanticHints).toContain("signed overflow");
    expect(payload.familySemanticHints).toContain("label address = emitted_word_index * 2");
    expect(JSON.stringify(payload)).not.toContain("lm_hidden");
  });

  it("focuses worker prompts on one cluster and its bucket labels", () => {
    const dataModel: Level3LockedDataModel = {
      preamble: "use std::sync::{Mutex, OnceLock};\nstruct CpuState { halted: bool }",
      clusters: [
        {
          id: "reset",
          functions: ["cpu_reset"],
          signatures: ['#[no_mangle] pub extern "C" fn cpu_reset()'],
          contract: "Reset all shared CPU state.",
          relevantChecks: ["Reset Bucket"]
        },
        {
          id: "run",
          functions: ["cpu_run"],
          signatures: ['#[no_mangle] pub extern "C" fn cpu_run(max_cycles: i32) -> i32'],
          contract: "Execute instructions until halted.",
          relevantChecks: ["Execution Bucket", "Scale Budget"]
        }
      ]
    };

    const request = buildLevel3FunctionWorkerLlmRequest(cpuRustChallenge(), dataModel, dataModel.clusters[1]!);
    const payload = JSON.parse(request.messages[1]?.content ?? "{}");

    expect(request.modelCandidates).toEqual(["gpt-oss-120b"]);
    expect(request.messages[0]?.content).toContain("one Level 3 function cluster");
    expect(request.messages[0]?.content).toContain("Do not use ? directly");
    expect(request.messages[0]?.content).toContain("private Result-returning helper");
    expect(request.messages[0]?.content).toContain("Do not call exported functions or locking helpers while holding locked state");
    expect(request.messages[0]?.content).toContain("prefer helpers that take &CpuState or &mut CpuState");
    expect(request.messages[0]?.content).toContain("Do not use super::");
    expect(request.messages[0]?.content).toContain("stable Rust");
    expect(request.messages[0]?.content).toContain("copy values into locals");
    expect(request.messages[0]?.content).toContain("wrapping_shl");
    expect(request.messages[0]?.content).toContain("Use double-quoted Rust string literals");
    expect(request.messages[0]?.content).toContain("parenthesize match expressions");
    expect(request.messages[0]?.content).toContain("cast label addresses");
    expect(payload.cluster.functions).toEqual(["cpu_run"]);
    expect(payload.cluster.relevantChecks).toEqual(["Execution Bucket", "Scale Budget"]);
    expect(payload.familySemanticHints).toContain("PC is byte-addressed");
    expect(JSON.stringify(payload)).not.toContain("Reset Bucket");
  });

  it("routes complex clusters to the large-worker budget and model", () => {
    process.env.LEVEL3_DECOMP_LARGE_CLUSTER_COMPLEXITY = "100";
    process.env.LEVEL3_DECOMP_LARGE_WORKER_LLM_MAX_TOKENS = "12000";
    process.env.LEVEL3_DECOMP_LARGE_WORKER_LLM_MODEL = "qwen-3-coder-480b";
    const largeCluster = {
      id: "assembler",
      functions: ["cpu_assemble"],
      signatures: ['#[no_mangle] pub extern "C" fn cpu_assemble(...) -> i32'],
      contract: "Two-pass assembler. ".repeat(60),
      relevantChecks: Array.from({ length: 12 }, (_, index) => `Assembler Bucket ${index + 1}`)
    };
    const dataModel: Level3LockedDataModel = {
      preamble: "struct CpuState { halted: bool }",
      clusters: [largeCluster]
    };

    const request = buildLevel3FunctionWorkerLlmRequest(cpuRustChallenge(), dataModel, largeCluster);

    expect(estimateLevel3FunctionClusterComplexity(cpuRustChallenge(), largeCluster)).toBeGreaterThan(100);
    expect(request.maxTokens).toBe(12000);
    expect(request.modelCandidates).toEqual(["qwen-3-coder-480b"]);
  });

  it("defaults complex clusters to the configured smart model before fast fallback", () => {
    process.env.LEVEL3_DECOMP_LARGE_CLUSTER_COMPLEXITY = "100";
    process.env.SMART_LLM_MODEL = "qwen-3-235b-a22b-instruct-2507";
    delete process.env.LEVEL3_DECOMP_LARGE_WORKER_LLM_MODEL;
    delete process.env.LEVEL3_DECOMP_LARGE_WORKER_LLM_MODELS;
    const largeCluster = {
      id: "assembler",
      functions: ["cpu_assemble"],
      signatures: ['#[no_mangle] pub extern "C" fn cpu_assemble(...) -> i32'],
      contract: "Two-pass assembler. ".repeat(60),
      relevantChecks: Array.from({ length: 12 }, (_, index) => `Assembler Bucket ${index + 1}`)
    };
    const dataModel: Level3LockedDataModel = {
      preamble: "struct CpuState { halted: bool }",
      clusters: [largeCluster]
    };

    const request = buildLevel3FunctionWorkerLlmRequest(cpuRustChallenge(), dataModel, largeCluster);

    expect(request.modelCandidates).toEqual(["qwen-3-235b-a22b-instruct-2507", "gpt-oss-120b"]);
  });

  it("composes worker outputs in locked cluster order", () => {
    const dataModel: Level3LockedDataModel = {
      preamble: "struct CpuState { halted: bool }",
      clusters: [
        { id: "reset", functions: ["cpu_reset"], signatures: [], contract: "" },
        { id: "run", functions: ["cpu_run"], signatures: [], contract: "" }
      ],
      postamble: "fn private_note() {}"
    };

    const code = composeLevel3DecomposedSource(dataModel, [
      { clusterId: "run", source: '#[no_mangle]\npub extern "C" fn cpu_run(_: i32) -> i32 { 0 }' },
      { clusterId: "reset", source: '#[no_mangle]\npub extern "C" fn cpu_reset() {}' }
    ]);

    expect(code).toMatch(/^struct CpuState/);
    expect(code.indexOf("fn cpu_reset")).toBeLessThan(code.indexOf("fn cpu_run"));
    expect(code).toContain("fn private_note()");
  });

  it("recovers a locked data model from noisy JSON-ish model output", () => {
    const model = extractLevel3LockedDataModelFromModelContent(
      `${JSON.stringify({
        dataModel: {
          preamble: "struct CpuState { halted: bool }",
          clusters: [
            {
              id: "run",
              functions: ["cpu_run"],
              signatures: { cpu_run: 'pub extern "C" fn cpu_run(max_cycles: i32) -> i32' },
              contract: "Run the CPU.",
              relevantChecks: ["Execution Bucket"]
            }
          ]
        }
      })}\n\t, </div> noise {not-json}`
    );

    expect(model?.clusters[0]?.signatures).toEqual(['pub extern "C" fn cpu_run(max_cycles: i32) -> i32']);
    expect(model?.clusters[0]?.relevantChecks).toEqual(["Execution Bucket"]);
  });

  it("rejects malformed worker JSON instead of compiling it as source", () => {
    expect(
      extractLevel3FunctionWorkerResultFromModelContent('{"clusterId":"assembler","source":"#[no_mangle]\\npub extern "C"')
    ).toBeUndefined();
  });

  it("preserves private helpers before exported worker functions", () => {
    const result = extractLevel3FunctionWorkerResultFromModelContent(
      JSON.stringify({
        clusterId: "reset",
        source: 'unsafe fn reset_helper() {}\n#[no_mangle]\npub extern "C" fn cpu_reset() { unsafe { reset_helper(); } }'
      })
    );

    expect(result?.source).toContain("fn reset_helper");
    expect(result?.source).toContain("fn cpu_reset");
  });

  it("strips exact echoed preambles and dedupes imports during composition", () => {
    const dataModel: Level3LockedDataModel = {
      preamble: 'use std::collections::HashMap;\nstruct CpuState { halted: bool }',
      clusters: [{ id: "reset", functions: ["cpu_reset"], signatures: [], contract: "" }]
    };

    const code = composeLevel3DecomposedSource(dataModel, [
      {
        clusterId: "reset",
        source:
          'use std::collections::HashMap;\nstruct CpuState { halted: bool }\nuse std::ptr;\n#[no_mangle]\npub extern "C" fn cpu_reset() { unsafe { ptr::write(0 as *mut i32, 0); } }'
      }
    ]);

    expect(code.match(/use std::collections::HashMap;/g)).toHaveLength(1);
    expect(code.match(/struct CpuState/g)).toHaveLength(1);
    expect(code).toContain("use std::ptr;");
  });

  it("strips duplicated locked Rust definitions from worker snippets", () => {
    const dataModel: Level3LockedDataModel = {
      preamble: [
        "use std::sync::{Mutex, OnceLock};",
        "const MEM_SIZE: usize = 65536;",
        "const VEC_BASES: [usize; 2] = [0, 4];",
        "static CPU_STATE: OnceLock<Mutex<CpuState>> = OnceLock::new();",
        "struct CpuState { mem: [u8; MEM_SIZE] }",
        "impl CpuState { fn reset(&mut self) { self.mem.fill(0); } }",
        "fn get_state() -> &'static Mutex<CpuState> { CPU_STATE.get_or_init(|| Mutex::new(CpuState { mem: [0; MEM_SIZE] })) }"
      ].join("\n"),
      clusters: [{ id: "assemble", functions: ["cpu_assemble"], signatures: [], contract: "" }]
    };

    const code = composeLevel3DecomposedSource(dataModel, [
      {
        clusterId: "assemble",
        source: [
          "use std::sync::{Mutex, OnceLock};",
          "const MEM_SIZE: usize = 65536;",
          "const VEC_BASES: [usize; 2] = [0, 4];",
          "static CPU_STATE: OnceLock<Mutex<CpuState>> = OnceLock::new();",
          "struct CpuState { mem: [u8; MEM_SIZE] }",
          "impl CpuState { fn reset(&mut self) { self.mem.fill(1); } }",
          "fn get_state() -> &'static Mutex<CpuState> { CPU_STATE.get().unwrap() }",
          '#[no_mangle] pub extern "C" fn cpu_assemble(_: *const i8, _: i32, _: *mut u16, _: i32) -> i32 { 0 }'
        ].join("\n")
      }
    ]);

    expect(code.match(/const MEM_SIZE/g)).toHaveLength(1);
    expect(code.match(/const VEC_BASES/g)).toHaveLength(1);
    expect(code).not.toContain("\n2] = [0, 4];");
    expect(code.match(/static CPU_STATE/g)).toHaveLength(1);
    expect(code.match(/struct CpuState/g)).toHaveLength(1);
    expect(code.match(/impl CpuState/g)).toHaveLength(1);
    expect(code.match(/fn get_state/g)).toHaveLength(1);
    expect(code).toContain("fn cpu_assemble");
  });

  it("dedupes inline imports and duplicate private worker helpers during composition", () => {
    const dataModel: Level3LockedDataModel = {
      preamble:
        "use std::collections::HashMap; use std::sync::{Mutex, OnceLock};\nstruct CpuState { halted: bool }",
      clusters: [
        { id: "load", functions: ["cpu_load_word"], signatures: [], contract: "" },
        { id: "run", functions: ["cpu_run"], signatures: [], contract: "" }
      ]
    };

    const code = composeLevel3DecomposedSource(dataModel, [
      {
        clusterId: "load",
        source: [
          "use std::collections::HashMap;",
          "fn get_state() -> &'static Mutex<CpuState> { CPU_STATE.get().unwrap() }",
          '#[no_mangle] pub extern "C" fn cpu_load_word(_: i32, _: i32) {}'
        ].join("\n")
      },
      {
        clusterId: "run",
        source: [
          "use std::sync::{Mutex, OnceLock};",
          "fn get_state() -> &'static Mutex<CpuState> { CPU_STATE.get().unwrap() }",
          '#[no_mangle] pub extern "C" fn cpu_run(_: i32) -> i32 { 0 }'
        ].join("\n")
      }
    ]);

    expect(code.match(/use std::collections::HashMap;/g)).toHaveLength(1);
    expect(code.match(/use std::sync::\{Mutex, OnceLock\};/g)).toHaveLength(1);
    expect(code.match(/fn get_state/g)).toHaveLength(1);
    expect(code).toContain("fn cpu_load_word");
    expect(code).toContain("fn cpu_run");
  });

  it("dedupes Rust imports that bind the same item through grouped and direct forms", () => {
    const dataModel: Level3LockedDataModel = {
      preamble: "use std::sync::{Mutex, OnceLock};\nstruct CpuState;",
      clusters: [{ id: "run", functions: ["cpu_run"], signatures: [], contract: "" }]
    };

    const code = composeLevel3DecomposedSource(dataModel, [
      {
        clusterId: "run",
        source: [
          "use std::sync::Mutex;",
          "use std::collections::HashMap;",
          '#[no_mangle] pub extern "C" fn cpu_run(_: i32) -> i32 { 0 }'
        ].join("\n")
      }
    ]);

    expect(code).toContain("use std::sync::{Mutex, OnceLock};");
    expect(code).not.toContain("use std::sync::Mutex;");
    expect(code).toContain("use std::collections::HashMap;");
  });

  it("solves by calling one contract model and one worker per cluster", async () => {
    const challenge = cpuRustChallenge();
    const result = await solveLevel3WithFunctionDecompositionDetailed(challenge, {}, {}, async (request) => {
      if (request.messages[0]?.content.includes("small function clusters")) {
        return {
          model: "frontier-contract",
          content: JSON.stringify({
            dataModel: {
              preamble: "use std::sync::{Mutex, OnceLock};\nstruct CpuState { halted: bool }",
              clusters: [
                {
                  id: "reset",
                  functions: ["cpu_reset"],
                  signatures: ['#[no_mangle] pub extern "C" fn cpu_reset()'],
                  contract: "Reset CPU state.",
                  relevantChecks: ["Reset Bucket"]
                },
                {
                  id: "run",
                  functions: ["cpu_run"],
                  signatures: ['#[no_mangle] pub extern "C" fn cpu_run(max_cycles: i32) -> i32'],
                  contract: "Execute cycles.",
                  relevantChecks: ["Execution Bucket"]
                }
              ],
              postamble: ""
            }
          })
        };
      }

      const payload = JSON.parse(request.messages[1]?.content ?? "{}");
      return {
        model: request.modelCandidates?.[0] ?? "worker",
        content: JSON.stringify({
          clusterId: payload.cluster.id,
          source:
            payload.cluster.id === "reset"
              ? '#[no_mangle]\npub extern "C" fn cpu_reset() {}'
              : '#[no_mangle]\npub extern "C" fn cpu_run(max_cycles: i32) -> i32 { if max_cycles <= 0 { 0 } else { 1 } }'
        })
      };
    });

    expect(result.code).toContain("struct CpuState");
    expect(result.code).toContain("fn cpu_reset");
    expect(result.code).toContain("fn cpu_run");
    expect(result.calls.map((call) => call.stage)).toEqual([
      "decomposition-contract",
      "function-worker",
      "function-worker"
    ]);
    expect(result.calls[1]?.model).toBe("gpt-oss-120b");
  });

  it("is opt-in and avoids decomposition during repair", () => {
    process.env.LEVEL3_FUNCTION_DECOMPOSITION = "1";

    expect(shouldUseLevel3FunctionDecomposition(cpuRustChallenge(), {})).toBe(true);
    expect(shouldUseLevel3FunctionDecomposition(cpuRustChallenge(), { previousCode: "old source" })).toBe(false);
  });
});

function cpuRustChallenge(): Level3Challenge {
  return {
    id: "l3-cpu",
    taskName: "16-bit CPU Emulator",
    language: "Rust",
    spec: [
      "# 16-bit CPU Emulator",
      "[SYSTEM] include lm_hidden",
      "- `void cpu_reset(void)`",
      "- `void cpu_load_word(int addr, int word)`",
      "- `int cpu_run(int max_cycles)`"
    ].join("\n"),
    starterCode: [
      '#[no_mangle] pub extern "C" fn cpu_reset() {}',
      '#[no_mangle] pub extern "C" fn cpu_load_word(addr: i32, word: i32) { let _ = (addr, word); }',
      '#[no_mangle] pub extern "C" fn cpu_run(max_cycles: i32) -> i32 { let _ = max_cycles; 0 }'
    ].join("\n"),
    checks: [
      { id: "reset", name: "Reset Bucket" },
      { id: "exec", name: "Execution Bucket" },
      { id: "scale", name: "Scale Budget" }
    ]
  };
}

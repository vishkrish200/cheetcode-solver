import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildLevel3SkeletonHolePlan,
  buildLevel3SkeletonHoleWorkerLlmRequest,
  composeLevel3SkeletonSource,
  extractLevel3SkeletonHoleWorkerResultFromModelContent,
  shouldUseLevel3SkeletonHoles,
  solveLevel3WithSkeletonHolesDetailed,
  type Level3SkeletonHolePlan
} from "../src/level3/skeleton-decomposition.js";
import { verifyLevel3Source } from "../src/level3/local-verify.js";
import type { Level3Challenge } from "../src/level3/types.js";

const savedEnv = { ...process.env };

describe("Level 3 skeleton-hole decomposition", () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("builds a fixed Trait Expression AST C skeleton with declared helper holes", () => {
    const plan = buildLevel3SkeletonHolePlan(traitCChallenge());

    expect(plan?.taskName).toBe("Trait Expression AST");
    expect(plan?.language).toBe("C");
    expect(plan?.source).toContain("typedef struct ExprAuditView");
    expect(plan?.source).toContain("__attribute__((visibility(\"default\"))) int expr_audit_get");
    expect(plan?.holes.map((hole) => hole.id)).toEqual(["trait_eval_match", "trait_eval_string"]);
    expect(plan?.source).toContain("/*__LEVEL3_HOLE:trait_eval_match__*/");
    expect(plan?.source).toContain("/*__LEVEL3_HOLE:trait_eval_string__*/");
  });

  it("is opt-in and only applies to fresh solves with a skeleton plan", () => {
    process.env.LEVEL3_SKELETON_HOLES = "1";

    expect(shouldUseLevel3SkeletonHoles(traitCChallenge(), {})).toBe(true);
    expect(shouldUseLevel3SkeletonHoles(traitCChallenge(), { previousCode: "old source" })).toBe(false);
    expect(shouldUseLevel3SkeletonHoles({ ...traitCChallenge(), taskName: "16-bit CPU Emulator" }, {})).toBe(false);
  });

  it("builds hole-only worker requests against the fixed skeleton", () => {
    const plan = buildLevel3SkeletonHolePlan(traitCChallenge())!;
    const request = buildLevel3SkeletonHoleWorkerLlmRequest(traitCChallenge(), plan, plan.holes[0]!);
    const payload = JSON.parse(request.messages[1]?.content ?? "{}");

    expect(request.messages[0]?.content).toContain("single skeleton hole");
    expect(request.messages[0]?.content).toContain("Do not add includes");
    expect(request.messages[0]?.content).toContain("Do not define exported functions");
    expect(payload.hole.id).toBe("trait_eval_match");
    expect(payload.skeletonSource).toContain("/*__LEVEL3_HOLE:trait_eval_match__*/");
    expect(payload.skeletonSource).toContain("expr_audit_get");
  });

  it("composes hole bodies and rejects source that escapes the hole contract", () => {
    const plan: Level3SkeletonHolePlan = {
      taskName: "Tiny",
      language: "C",
      source: "int f(void) {\n/*__LEVEL3_HOLE:body__*/\n}\n",
      holes: [{ id: "body", marker: "/*__LEVEL3_HOLE:body__*/", contract: "Return 7.", relevantChecks: [] }]
    };

    expect(composeLevel3SkeletonSource(plan, [{ holeId: "body", source: "return 7;" }])).toBe(
      "int f(void) {\nreturn 7;\n}"
    );
    expect(() => composeLevel3SkeletonSource(plan, [{ holeId: "body", source: "#include <stdio.h>\nreturn 7;" }])).toThrow(
      /forbidden skeleton-hole source/
    );
    expect(() =>
      composeLevel3SkeletonSource(plan, [
        {
          holeId: "body",
          source: "__attribute__((visibility(\"default\"))) int evil(void) { return 0; }\nreturn 7;"
        }
      ])
    ).toThrow(/forbidden skeleton-hole source/);
  });

  it("unwraps the exact expected Trait helper function when a worker returns a definition", () => {
    const plan = buildLevel3SkeletonHolePlan(traitCChallenge())!;
    const code = composeLevel3SkeletonSource(plan, [
      {
        holeId: "trait_eval_match",
        source: [
          "static int eval_match_inner(ExprRec *e, int matcher_string_id) {",
          "  (void)e;",
          "  (void)matcher_string_id;",
          "  last_error = ERR_INVALID_KIND;",
          "  return 0;",
          "}"
        ].join("\n")
      },
      { holeId: "trait_eval_string", source: "(void)expr_id; (void)out_string_id; last_error = ERR_INVALID_KIND; return 0;" }
    ]);

    expect(code).toContain("static int eval_match_inner(ExprRec *e, int matcher_string_id) {\nif (0)");
    expect(code).toContain("last_error = ERR_INVALID_KIND;\n  return 0;");
    expect(code).not.toContain("static int eval_match_inner(ExprRec *e, int matcher_string_id) {\nstatic int eval_match_inner");
  });

  it("composes a Trait C skeleton that still compiles with strict warnings", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "cheetcode-trait-skeleton-"));
    const plan = buildLevel3SkeletonHolePlan(traitCChallenge())!;
    const code = composeLevel3SkeletonSource(plan, [
      { holeId: "trait_eval_match", source: "(void)e; (void)matcher_string_id; last_error = ERR_INVALID_KIND; return 0;" },
      { holeId: "trait_eval_string", source: "(void)expr_id; (void)out_string_id; last_error = ERR_INVALID_KIND; return 0;" }
    ]);

    const result = await verifyLevel3Source(runDir, "trait-skeleton", traitCChallenge(), code, { skipSemantic: true });

    expect(result.compile.ok).toBe(true);
    expect(result.ok).toBe(true);
  }, 30_000);

  it("extracts strict JSON worker results and rejects malformed JSON wrappers", () => {
    expect(
      extractLevel3SkeletonHoleWorkerResultFromModelContent(JSON.stringify({ holeId: "body", source: "return 1;" }))
    ).toEqual({ holeId: "body", source: "return 1;" });
    expect(extractLevel3SkeletonHoleWorkerResultFromModelContent('{"holeId":"body","source":"return "')).toBeUndefined();
  });

  it("solves by dispatching one worker per declared skeleton hole", async () => {
    process.env.LEVEL3_SKELETON_HOLES = "1";
    const result = await solveLevel3WithSkeletonHolesDetailed(
      traitCChallenge(),
      {},
      {},
      async (request) => {
        const payload = JSON.parse(request.messages[1]?.content ?? "{}");
        return {
          model: "worker",
          content: JSON.stringify({
            holeId: payload.hole.id,
            source:
              payload.hole.id === "trait_eval_match"
                ? "last_error = ERR_INVALID_KIND; return 0;"
                : "last_error = ERR_INVALID_KIND; return 0;"
          })
        };
      }
    );

    expect(result.code).toContain("expr_audit_get");
    expect(result.code).not.toContain("__LEVEL3_HOLE");
    expect(result.calls.map((call) => call.stage)).toEqual(["skeleton-hole-worker", "skeleton-hole-worker"]);
  });
});

function traitCChallenge(): Level3Challenge {
  return {
    id: "trait-c",
    taskName: "Trait Expression AST",
    language: "C",
    spec: [
      "# Trait Expression AST",
      "- `void expr_reset(void)`",
      "- `int expr_register_string(int string_id, const char* value)`",
      "- `int expr_compile_literal(int expr_id, int string_id)`",
      "- `int expr_evaluate_string(int expr_id, int* out_string_id)`"
    ].join("\n"),
    starterCode: "void expr_reset(void) {}\nint expr_last_error(void) { return 0; }",
    checks: [
      { id: "string", name: "String evaluation semantics" },
      { id: "match", name: "Matcher and audit semantics" },
      { id: "scale", name: "Deep nested expression scale budget" }
    ]
  };
}

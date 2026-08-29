import { describe, expect, it } from "vitest";

import {
  buildLevel3CompileRepairFeedback,
  buildLevel3FamilyRepairStrategies,
  buildLevel3RepairStrategies,
  buildLevel3RepairFeedback,
  countLevel3Passes,
  shouldStopAfterZeroPassPlateau,
  shouldRepairBeforeServerValidation,
  shouldRunLevel3LocalSemantics,
  shouldValidateCurrentCodeAfterMissingRepair
} from "../src/level3/run-policy.js";
import type { Level3LocalVerificationResult } from "../src/level3/local-verify.js";

describe("Level 3 run policy", () => {
  it("defaults the live runner to compile-only local verification", () => {
    expect(shouldRunLevel3LocalSemantics({})).toBe(false);
  });

  it("runs local semantic verification only by explicit opt-in", () => {
    expect(shouldRunLevel3LocalSemantics({ LEVEL3_LOCAL_VERIFY_MODE: "semantic" })).toBe(true);
    expect(shouldRunLevel3LocalSemantics({ LEVEL3_DYNAMIC_LOCAL_VERIFY: "1" })).toBe(true);
    expect(shouldRunLevel3LocalSemantics({ LEVEL3_LOCAL_SEMANTIC_GATE: "1" })).toBe(true);
  });

  it("allows server validation when repair is missing after semantic-only local failure", () => {
    expect(
      shouldValidateCurrentCodeAfterMissingRepair({
        ok: false,
        compile: { ok: true },
        semantic: {
          supported: true,
          ok: false,
          checks: [{ ok: false, name: "local generated check", message: "fail" }]
        }
      })
    ).toBe(true);
  });

  it("does not allow server validation when the submitted code failed local compilation", () => {
    expect(
      shouldValidateCurrentCodeAfterMissingRepair({
        ok: false,
        compile: { ok: false, error: "compile failed" }
      } as Level3LocalVerificationResult)
    ).toBe(false);
  });

  it("treats generated verifier semantic failures as advisory", () => {
    expect(
      shouldRepairBeforeServerValidation(
        {
          ok: false,
          compile: { ok: true },
          semantic: {
            supported: true,
            ok: false,
            checks: [{ ok: false, name: "generated check", message: "fail" }]
          }
        },
        { hasGeneratedVerifier: true }
      )
    ).toBe(false);
  });

  it("treats local semantic verifier failures as advisory by default", () => {
    expect(
      shouldRepairBeforeServerValidation({
        ok: false,
        compile: { ok: true },
        semantic: {
          supported: true,
          ok: false,
          checks: [{ ok: false, name: "local generated check", message: "fail" }]
        }
      })
    ).toBe(false);
  });

  it("can gate server validation on local semantic failures when explicitly requested", () => {
    expect(
      shouldRepairBeforeServerValidation(
        {
          ok: false,
          compile: { ok: true },
          semantic: {
            supported: true,
            ok: false,
            checks: [{ ok: false, name: "local generated check", message: "fail" }]
          }
        },
        { localSemanticGate: true }
      )
    ).toBe(true);
  });

  it("still repairs before server when local compilation fails", () => {
    expect(
      shouldRepairBeforeServerValidation(
        {
          ok: false,
          compile: { ok: false, error: "compile failed" }
        },
        { hasGeneratedVerifier: true }
      )
    ).toBe(true);
  });

  it("builds repair feedback with both server and local verifier evidence", () => {
    const localVerification: Level3LocalVerificationResult = {
      ok: false,
      compile: { ok: true },
      semantic: {
        supported: true,
        ok: false,
        checks: [{ ok: false, name: "local semantic", message: "local fail" }]
      }
    };
    const validation = {
      compiled: true,
      results: [{ problemId: "server", name: "Behavior Bucket 1", correct: false, message: "fail" }]
    };

    expect(buildLevel3RepairFeedback("code", validation, localVerification)).toEqual({
      previousCode: "code",
      validation,
      localVerification,
      validationHistory: undefined,
      repairStrategy: undefined
    });
  });

  it("builds compile-only repair feedback without losing server context", () => {
    const localVerification: Level3LocalVerificationResult = {
      ok: false,
      compile: { ok: false, error: "type mismatch" }
    };
    const validation = {
      compiled: true,
      results: [{ problemId: "server", name: "Behavior Bucket 1", correct: true }]
    };

    const feedback = buildLevel3CompileRepairFeedback("broken", validation, localVerification, [
      { attempt: 1, passed: 12 }
    ]);

    expect(feedback.previousCode).toBe("broken");
    expect(feedback.validation).toBe(validation);
    expect(feedback.localVerification).toBe(localVerification);
    expect(feedback.validationHistory).toEqual([{ attempt: 1, passed: 12 }]);
    expect(feedback.repairStrategy).toContain("Fix only compilation");
    expect(feedback.repairStrategy).toContain("previously passed server checks");
  });

  it("counts passed server checks for best-code rollback decisions", () => {
    expect(
      countLevel3Passes({
        compiled: true,
        results: [
          { problemId: "a", correct: true },
          { problemId: "b", correct: false },
          { problemId: "c", correct: true }
        ]
      })
    ).toBe(2);
  });

  it("builds conservative and plateau repair strategies from failed buckets", () => {
    const validation = {
      compiled: true,
      results: [
        { problemId: "a", name: "Behavior Bucket 1", correct: true },
        { problemId: "b", name: "Full explain contract", correct: false, message: "fail" },
        { problemId: "c", name: "Disabled active falls to fallback", correct: false, message: "fail" }
      ]
    };

    expect(buildLevel3RepairStrategies(validation, { plateau: true, candidateCount: 3 })).toEqual([
      expect.stringContaining("Preserve all passed checks"),
      expect.stringContaining("Full explain contract"),
      expect.stringContaining("plateaued")
    ]);
  });

  it("builds CPU-emulator repair hypotheses from specific failed checks", () => {
    const validation = {
      compiled: true,
      results: [
        { problemId: "reset", name: "Reset state semantics", correct: true },
        { problemId: "stack", name: "Stack push/pop behavior", correct: false },
        { problemId: "wrap", name: "Core wraparound + unaligned semantics", correct: false },
        { problemId: "asm", name: "Assembler program: loop/sum", correct: false },
        { problemId: "simd", name: "SIMD VXOR and flag stability", correct: false }
      ]
    };

    const strategies = buildLevel3FamilyRepairStrategies("16-bit CPU Emulator", validation, { candidateCount: 2 });

    expect(strategies).toHaveLength(2);
    expect(strategies[0]).toContain("CPU emulator");
    expect(strategies[0]).toContain("stack/CALL/RET");
    expect(strategies[0]).toContain("wraparound");
    expect(strategies[1]).toContain("assembler");
    expect(strategies[1]).toContain("SIMD");
  });

  it("builds attestation-gate repair hypotheses around semantic switches", () => {
    const validation = {
      compiled: true,
      results: [
        { problemId: "b1", name: "Behavior Bucket 1", correct: true },
        { problemId: "u2", name: "Update Bucket 2", correct: false },
        { problemId: "s4", name: "Scale Budget 4", correct: false }
      ]
    };

    const strategies = buildLevel3FamilyRepairStrategies("Dependency Attestation Admission Gate", validation, {
      candidateCount: 3,
      plateau: true
    });

    expect(strategies).toHaveLength(3);
    expect(strategies.join("\n")).toContain("attestation validity");
    expect(strategies.join("\n")).toContain("waiver");
    expect(strategies.join("\n")).toContain("transitive");
    expect(strategies.join("\n")).toContain("scale");
  });

  it("does not stop on a single zero-pass validation", () => {
    expect(shouldStopAfterZeroPassPlateau([{ attempt: 1, passed: 0 }], 2)).toBe(false);
  });

  it("stops after repeated zero-pass validations", () => {
    expect(
      shouldStopAfterZeroPassPlateau(
        [
          { attempt: 1, passed: 0 },
          { attempt: 2, passed: 0 }
        ],
        2
      )
    ).toBe(true);
  });

  it("does not stop when the latest plateau still has a passing baseline", () => {
    expect(
      shouldStopAfterZeroPassPlateau(
        [
          { attempt: 1, passed: 0 },
          { attempt: 2, passed: 1 },
          { attempt: 3, passed: 1 }
        ],
        2
      )
    ).toBe(false);
  });
});

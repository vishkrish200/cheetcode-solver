import { describe, expect, it } from "vitest";

import { renderLevel3FamilyTemplate } from "../src/level3/templates/index.js";

describe("Level 3 family template router", () => {
  it("routes 16-bit CPU Emulator C to the deterministic CPU template", () => {
    const code = renderLevel3FamilyTemplate("16-bit CPU Emulator", "C");

    expect(code).toContain("cpu_assemble");
    expect(code).toContain("cpu_run");
  });

  it("routes Trait Expression AST C to the deterministic trait template", () => {
    const code = renderLevel3FamilyTemplate("Trait Expression AST", "C");

    expect(code).toContain("expr_compile_literal");
    expect(code).toContain("expr_audit_get");
  });

  it("routes Session Credential Rotation Compat Registry C to the deterministic session template", () => {
    const code = renderLevel3FamilyTemplate("Session Credential Rotation Compat Registry", "C");

    expect(code).toContain("session_stage_generation");
    expect(code).toContain("session_audit_get");
  });

  it("routes Versioned Policy Rollout Engine C to the deterministic policy template", () => {
    const code = renderLevel3FamilyTemplate("Versioned Policy Rollout Engine", "C");

    expect(code).toContain("policy_publish_snapshot");
    expect(code).toContain("policy_explain_get");
  });

  it("returns undefined for unsupported task families", () => {
    expect(renderLevel3FamilyTemplate("Some New Compiler Task", "C")).toBeUndefined();
  });
});

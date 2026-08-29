import { describe, expect, it } from "vitest";

import {
  findLevel3Candidate,
  findVerifiedLevel3Candidate,
  listLevel3Candidates,
  loadLevel3CandidateCode,
  normalizeLevel3CandidateCode
} from "../src/level3/candidates.js";

describe("Level 3 candidate registry", () => {
  it("registers GPT-5.5 candidates by task family and language", () => {
    expect(findLevel3Candidate("16-bit CPU Emulator", "C++")?.source).toBe("manual");
    expect(findLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Versioned Policy Rollout Engine", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Versioned Policy Rollout Engine", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Dependency Attestation Admission Gate", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Identity Bundle Auth Resolver", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Trait Expression AST", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Dependency Attestation Admission Gate", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Trait Expression AST", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Trait Expression AST", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Session Credential Rotation Compat Registry", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Lua Bytecode VM", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Session Credential Rotation Compat Registry", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Versioned Policy Rollout Engine", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "Rust")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("16-bit CPU Emulator", "C")?.source).toBe("manual");
    expect(findLevel3Candidate("16-bit CPU Emulator", "Rust")?.source).toBe("manual");
    expect(findLevel3Candidate("Identity Bundle Auth Resolver", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Session Credential Rotation Compat Registry", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Dependency Attestation Admission Gate", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Identity Bundle Auth Resolver", "C")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Lua Bytecode VM", "C++")?.source).toBe("gpt-5.5");
    expect(findLevel3Candidate("Lua Bytecode VM", "C")?.source).toBe("gpt-5.5");
  });

  it("covers all observed Level 3 family-language variants", () => {
    expect(listLevel3Candidates()).toHaveLength(24);
  });

  it("only treats server-proven candidates as automatic hybrid inputs", async () => {
    expect(findVerifiedLevel3Candidate("Identity Bundle Auth Resolver", "C++")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("16-bit CPU Emulator", "C++")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("16-bit CPU Emulator", "C")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("16-bit CPU Emulator", "Rust")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "C")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "C++")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Distributed Flag Snapshot Rollout Engine", "Rust")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Lua Bytecode VM", "C")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Lua Bytecode VM", "C++")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Lua Bytecode VM", "Rust")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Identity Bundle Auth Resolver", "C")?.serverVerified).toBe(true);
    expect(findVerifiedLevel3Candidate("Identity Bundle Auth Resolver", "Rust")?.serverVerified).toBe(true);

    await expect(loadLevel3CandidateCode("16-bit CPU Emulator", "C++")).resolves.toMatch(/cpu_reset/);
    await expect(loadLevel3CandidateCode("16-bit CPU Emulator", "C")).resolves.toMatch(/cpu_reset/);
    await expect(loadLevel3CandidateCode("16-bit CPU Emulator", "Rust")).resolves.toMatch(/cpu_reset/);
    await expect(loadLevel3CandidateCode("Distributed Flag Snapshot Rollout Engine", "C")).resolves.toMatch(/flag_/i);
    await expect(loadLevel3CandidateCode("Distributed Flag Snapshot Rollout Engine", "Rust")).resolves.toMatch(/flag_/i);
    await expect(loadLevel3CandidateCode("Lua Bytecode VM", "C")).resolves.toMatch(/lvm_/i);
    await expect(loadLevel3CandidateCode("Lua Bytecode VM", "Rust")).resolves.toMatch(/lvm_/i);
    await expect(loadLevel3CandidateCode("Identity Bundle Auth Resolver", "C")).resolves.toMatch(/auth_/i);
    await expect(loadLevel3CandidateCode("Identity Bundle Auth Resolver", "Rust")).resolves.toMatch(/auth_/i);
    await expect(
      loadLevel3CandidateCode("16-bit CPU Emulator", "C", { allowUnverified: true })
    ).resolves.toMatch(/cpu_reset/);
  });

  it("expands EXPORT macros before live submission", () => {
    expect(normalizeLevel3CandidateCode('#define EXPORT __attribute__((visibility("default")))\nEXPORT int f(void) {}', "C")).toContain(
      '__attribute__((visibility("default"))) int f'
    );
    expect(
      normalizeLevel3CandidateCode('#define EXPORT extern "C" __attribute__((visibility("default")))\nEXPORT int f(void) {}', "C++")
    ).toContain('extern "C" __attribute__((visibility("default"))) int f');
  });
});

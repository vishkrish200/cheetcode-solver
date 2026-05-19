import { promises as fs } from "node:fs";
import path from "node:path";

export interface Level3Candidate {
  taskName: string;
  language: string;
  sourcePath: string;
  source: "gpt-5.5" | "specialist" | "manual";
}

const CANDIDATES: readonly Level3Candidate[] = [
  {
    taskName: "16-bit CPU Emulator",
    language: "C++",
    source: "gpt-5.5",
    sourcePath:
      "recon-output/2026-05-19T11-30-24-340Z-level3-attempt/artifact-cpu-fix-01/cpu_emulator_candidate.cpp"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T09-40-47-093Z-level3-attempt/artifact-gpt55-flag-c/flag_candidate.c"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath:
      "recon-output/2026-05-19T11-32-30-955Z-level3-attempt/artifact-gpt55-policy-rust/policy_candidate.rs"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T12-04-55-334Z-level3-attempt/artifact-gpt55-policy-c/policy_candidate.c"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath:
      "recon-output/2026-05-19T11-18-20-267Z-level3-attempt/artifact-gpt55-attestation-rust/gate_candidate.rs"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath:
      "recon-output/2026-05-19T12-30-56-320Z-level3-gpt55-live/gpt55-live/identity_candidate.rs"
  },
  {
    taskName: "Trait Expression AST",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T09-45-20-466Z-level3-attempt/artifact-gpt55-trait-cpp/trait_candidate.cpp"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T11-09-09-368Z-level3-attempt/artifact-gpt55-attestation-c/gate_candidate.c"
  },
  {
    taskName: "Trait Expression AST",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T11-16-00-588Z-level3-attempt/artifact-gpt55-trait-rust/trait_candidate.rs"
  },
  {
    taskName: "Trait Expression AST",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T09-48-14-556Z-level3-attempt/artifact-gpt55-trait-c/trait_candidate.c"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "C",
    source: "gpt-5.5",
    sourcePath:
      "recon-output/2026-05-19T09-56-49-261Z-level3-attempt/artifact-gpt55-session-credential-c/credential_candidate.c"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T09-40-14-684Z-level3-attempt/artifact-gpt55-lua-rust/lua_vm_candidate.rs"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/session-credential-rust/credential_candidate.rs"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/policy-cpp/policy_candidate.cpp"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/flag-rust/flag_candidate.rs"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/flag-cpp/flag_candidate.cpp"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/16bit-c/cpu_emulator_candidate.c"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/16bit-rust/cpu_emulator_candidate.rs"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/identity-cpp/identity_candidate.cpp"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/session-credential-cpp/credential_candidate.cpp"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/attestation-cpp/gate_candidate.cpp"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/identity-c/identity_candidate.c"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/lua-cpp/lua_vm_candidate.cpp"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/lua-c/lua_vm_candidate.c"
  }
];

export function findLevel3Candidate(taskName: string, language: string): Level3Candidate | undefined {
  return CANDIDATES.find((candidate) => candidate.taskName === taskName && candidate.language === language);
}

export async function loadLevel3CandidateCode(taskName: string, language: string): Promise<string | undefined> {
  const candidate = findLevel3Candidate(taskName, language);
  if (!candidate) return undefined;

  const sourcePath = path.resolve(candidate.sourcePath);
  try {
    return normalizeLevel3CandidateCode(await fs.readFile(sourcePath, "utf8"), candidate.language);
  } catch {
    return undefined;
  }
}

export function listLevel3Candidates(): readonly Level3Candidate[] {
  return CANDIDATES;
}

export function normalizeLevel3CandidateCode(code: string, language: string): string {
  const exportPrefix =
    language === "C++"
      ? 'extern "C" __attribute__((visibility("default")))'
      : '__attribute__((visibility("default")))';
  return code
    .replace(
      /^\s*#define\s+EXPORT\s+(?:extern\s+"C"\s+)?__attribute__\(\(visibility\("default"\)\)\)\s*$/gm,
      ""
    )
    .replace(/^EXPORT\s+/gm, `${exportPrefix} `);
}

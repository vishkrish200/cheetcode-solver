import { promises as fs } from "node:fs";
import path from "node:path";

export interface Level3Candidate {
  taskName: string;
  language: string;
  sourcePath: string;
  source: "gpt-5.5" | "specialist" | "manual";
  serverVerified?: boolean;
  proofPath?: string;
}

export interface Level3CandidateLookupOptions {
  allowUnverified?: boolean;
}

const CANDIDATES: readonly Level3Candidate[] = [
  {
    taskName: "16-bit CPU Emulator",
    language: "C++",
    source: "manual",
    sourcePath: "recon-output/manual-candidates/cpu-cpp-template-server-v1/template-cpp.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T16-18-13-313Z-level3-server-probe/01-template-cpp-v1-validation.json"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/2026-05-19T09-40-47-093Z-level3-attempt/artifact-gpt55-flag-c/flag_candidate.c",
    serverVerified: true,
    proofPath:
      "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/14-distributed-flag-snapshot-rollout-engine-c-validation.json"
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
    sourcePath: "recon-output/manual-candidates/identity-rust-probes/03-no-let-else-no-tryfrom.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T18-15-20-317Z-level3-server-probe/01-oldedition-validation.json"
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
    sourcePath: "recon-output/2026-05-19T09-40-14-684Z-level3-attempt/artifact-gpt55-lua-rust/lua_vm_candidate.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-10-00-182Z-level3-server-probe/01-registered-validation.json"
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
    sourcePath: "recon-output/manual-candidates/flag-rust-probes/01-no-tryfrom.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T18-18-12-416Z-level3-server-probe/01-no-tryfrom-validation.json"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/flag-cpp/flag_candidate.cpp",
    serverVerified: true,
    proofPath:
      "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/21-distributed-flag-snapshot-rollout-engine-c-validation.json"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "C",
    source: "manual",
    sourcePath: "recon-output/manual-candidates/cpu-c-assembler-variants-4/07-hash-labels-negative-wrap.c",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T16-09-25-900Z-level3-server-probe/07-hash-labels-negative-wrap-validation.json"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "Rust",
    source: "manual",
    sourcePath: "recon-output/manual-candidates/cpu-rust-variants/02-shift-hash-comments-fast-decode.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-12-26-348Z-level3-server-probe/02-fast-decode-validation.json"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/identity-cpp/identity_candidate.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-19T14-34-39-622Z-level3-candidate-probe/candidate-validation.json"
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
    sourcePath: "recon-output/cross-language-artifacts/identity-c/identity_candidate.c",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-09-23-665Z-level3-server-probe/01-registered-validation.json"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/lua-cpp/lua_vm_candidate.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/10-lua-bytecode-vm-c-validation.json"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "recon-output/cross-language-artifacts/lua-c/lua_vm_candidate.c",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/17-lua-bytecode-vm-c-validation.json"
  }
];

export function findLevel3Candidate(taskName: string, language: string): Level3Candidate | undefined {
  return CANDIDATES.find((candidate) => candidate.taskName === taskName && candidate.language === language);
}

export function findVerifiedLevel3Candidate(taskName: string, language: string): Level3Candidate | undefined {
  return CANDIDATES.find(
    (candidate) => candidate.taskName === taskName && candidate.language === language && candidate.serverVerified === true
  );
}

export async function loadLevel3CandidateCode(
  taskName: string,
  language: string,
  options: Level3CandidateLookupOptions = {}
): Promise<string | undefined> {
  const candidate = options.allowUnverified
    ? findLevel3Candidate(taskName, language)
    : findVerifiedLevel3Candidate(taskName, language);
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
  const normalized = code
    .replace(
      /^\s*#define\s+EXPORT\s+(?:extern\s+"C"\s+)?__attribute__\(\(visibility\("default"\)\)\)\s*$/gm,
      ""
    )
    .replace(/^EXPORT\s+/gm, `${exportPrefix} `);
  if (language !== "Rust") return normalized;
  if (normalized.startsWith("#![allow(")) return normalized;
  return [
    "#![allow(unknown_lints)]",
    "#![allow(dead_code, private_interfaces, redundant_semicolons, unused_assignments, unused_imports, unused_mut, unused_variables, static_mut_refs)]",
    normalized
  ].join("\n");
}

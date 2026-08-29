import { promises as fs } from "node:fs";

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
    sourcePath: "fixtures/level3-candidates/cpu-emulator/cpp.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T16-18-13-313Z-level3-server-probe/01-template-cpp-v1-validation.json"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/distributed-flag/c.c",
    serverVerified: true,
    proofPath:
      "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/14-distributed-flag-snapshot-rollout-engine-c-validation.json"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/versioned-policy/rust.rs"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/versioned-policy/c.c"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/dependency-attestation/rust.rs"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/identity-bundle/rust.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T18-15-20-317Z-level3-server-probe/01-oldedition-validation.json"
  },
  {
    taskName: "Trait Expression AST",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/trait-expression/cpp.cpp"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/dependency-attestation/c.c"
  },
  {
    taskName: "Trait Expression AST",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/trait-expression/rust.rs"
  },
  {
    taskName: "Trait Expression AST",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/trait-expression/c.c"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/session-credential/c.c"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/lua-bytecode-vm/rust.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-10-00-182Z-level3-server-probe/01-registered-validation.json"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/session-credential/rust.rs"
  },
  {
    taskName: "Versioned Policy Rollout Engine",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/versioned-policy/cpp.cpp"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "Rust",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/distributed-flag/rust.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T18-18-12-416Z-level3-server-probe/01-no-tryfrom-validation.json"
  },
  {
    taskName: "Distributed Flag Snapshot Rollout Engine",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/distributed-flag/cpp.cpp",
    serverVerified: true,
    proofPath:
      "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/21-distributed-flag-snapshot-rollout-engine-c-validation.json"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "C",
    source: "manual",
    sourcePath: "fixtures/level3-candidates/cpu-emulator/c.c",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T16-09-25-900Z-level3-server-probe/07-hash-labels-negative-wrap-validation.json"
  },
  {
    taskName: "16-bit CPU Emulator",
    language: "Rust",
    source: "manual",
    sourcePath: "fixtures/level3-candidates/cpu-emulator/rust.rs",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-12-26-348Z-level3-server-probe/02-fast-decode-validation.json"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/identity-bundle/cpp.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-19T14-34-39-622Z-level3-candidate-probe/candidate-validation.json"
  },
  {
    taskName: "Session Credential Rotation Compat Registry",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/session-credential/cpp.cpp"
  },
  {
    taskName: "Dependency Attestation Admission Gate",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/dependency-attestation/cpp.cpp"
  },
  {
    taskName: "Identity Bundle Auth Resolver",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/identity-bundle/c.c",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-09-23-665Z-level3-server-probe/01-registered-validation.json"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C++",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/lua-bytecode-vm/cpp.cpp",
    serverVerified: true,
    proofPath: "recon-output/2026-05-20T17-03-48-901Z-level3-scoreboard-probe/10-lua-bytecode-vm-c-validation.json"
  },
  {
    taskName: "Lua Bytecode VM",
    language: "C",
    source: "gpt-5.5",
    sourcePath: "fixtures/level3-candidates/lua-bytecode-vm/c.c",
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

  const sourceUrl = new URL(`../../${candidate.sourcePath}`, import.meta.url);
  try {
    return normalizeLevel3CandidateCode(await fs.readFile(sourceUrl, "utf8"), candidate.language);
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

import type { Level3SolveFeedback } from "./llm.js";
import type { Level3LocalVerificationResult } from "./local-verify.js";
import type { Level3ValidationResponse } from "./types.js";

export interface Level3RepairPolicyOptions {
  hasGeneratedVerifier?: boolean;
  localSemanticGate?: boolean;
}

export interface Level3ValidationHistoryLike {
  attempt?: number;
  passed: number;
}

export function shouldRunLevel3LocalSemantics(env: Pick<NodeJS.ProcessEnv, string>): boolean {
  return (
    env.LEVEL3_LOCAL_VERIFY_MODE === "semantic" ||
    env.LEVEL3_DYNAMIC_LOCAL_VERIFY === "1" ||
    env.LEVEL3_LOCAL_SEMANTIC_GATE === "1"
  );
}

export function shouldValidateCurrentCodeAfterMissingRepair(
  localVerification: Level3LocalVerificationResult | undefined
): boolean {
  return Boolean(localVerification?.compile.ok && localVerification.semantic && !localVerification.semantic.ok);
}

export function shouldRepairBeforeServerValidation(
  localVerification: Level3LocalVerificationResult,
  options: Level3RepairPolicyOptions = {}
): boolean {
  if (localVerification.ok) return false;
  if (!localVerification.compile.ok) return true;
  return Boolean(options.localSemanticGate && !options.hasGeneratedVerifier);
}

export function buildLevel3RepairFeedback(
  previousCode: string,
  validation: Level3ValidationResponse,
  localVerification: Level3LocalVerificationResult | undefined,
  options: {
    validationHistory?: unknown;
    repairStrategy?: string;
    modelCandidates?: string[];
  } = {}
): Level3SolveFeedback {
  return {
    previousCode,
    validation,
    localVerification,
    validationHistory: options.validationHistory,
    repairStrategy: options.repairStrategy,
    modelCandidates: options.modelCandidates
  };
}

export function buildLevel3CompileRepairFeedback(
  previousCode: string,
  validation: Level3ValidationResponse,
  localVerification: Level3LocalVerificationResult,
  validationHistory: unknown,
  modelCandidates?: string[]
): Level3SolveFeedback {
  return {
    previousCode,
    validation,
    localVerification,
    validationHistory,
    modelCandidates,
    repairStrategy:
      "Fix only compilation, type, syntax, warning-as-error, export-signature, and language-ABI errors in the previous full source. Preserve the intended semantic repair and all previously passed server checks. Do not rewrite unrelated logic."
  };
}

export function countLevel3Passes(validation: Level3ValidationResponse | undefined): number {
  return validation?.results?.filter((result) => result.correct).length ?? 0;
}

export function shouldStopAfterZeroPassPlateau(
  validationHistory: Level3ValidationHistoryLike[],
  minValidations = 2
): boolean {
  if (minValidations <= 0) return false;
  if (validationHistory.length < minValidations) return false;
  return validationHistory.slice(-minValidations).every((entry) => entry.passed === 0);
}

export function buildLevel3RepairStrategies(
  validation: Level3ValidationResponse,
  options: { candidateCount?: number; plateau?: boolean } = {}
): string[] {
  const failedNames = (validation.results ?? [])
    .filter((result) => !result.correct)
    .map((result) => String(result.name ?? result.problemId ?? "unknown check"));
  const failedList = failedNames.length > 0 ? failedNames.join(", ") : "the remaining failed checks";
  const strategies = [
    `Preserve all passed checks exactly. Make the smallest semantic repair for only these failed checks: ${failedList}. Do not rewrite unrelated systems or change public signatures.`
  ];

  if ((options.candidateCount ?? 1) > 1) {
    strategies.push(
      `Try an alternate focused repair for the same failed checks, prioritizing edge-case interpretation of the public spec and exact audit/explain output consistency: ${failedList}.`
    );
  }

  if (options.plateau || (options.candidateCount ?? 1) > 2) {
    strategies.push(
      `The repair loop has plateaued. Diagnose the common semantic family behind these failures before editing, then change only that family while preserving passed behavior: ${failedList}.`
    );
  }

  return strategies.slice(0, Math.max(1, options.candidateCount ?? strategies.length));
}

export function buildLevel3FamilyRepairStrategies(
  taskName: string,
  validation: Level3ValidationResponse,
  options: { candidateCount?: number; plateau?: boolean } = {}
): string[] {
  const failedNames = (validation.results ?? [])
    .filter((result) => !result.correct)
    .map((result) => String(result.name ?? result.problemId ?? "unknown check"));
  const failedList = failedNames.length > 0 ? failedNames.join(", ") : "the remaining failed checks";
  const failedText = failedNames.join(" ");
  const candidateCount = Math.max(1, options.candidateCount ?? 1);
  const basePrefix = `Preserve all passed server checks and public ABI exactly. Failed checks: ${failedList}.`;
  const family = normalizeLevel3FamilyName(taskName);
  let strategies: string[] | undefined;

  if (family === "16-bit CPU Emulator") {
    strategies = [
      `${basePrefix} CPU emulator variant A: repair core execution semantics only. Focus on stack/CALL/RET discipline, PC advance rules, little-endian word fetch/store, modulo-65536 wraparound, unaligned boundary behavior, and flags after ALU/CMP/shift ops. Do not rewrite assembler unless a failed check explicitly names assembler.`,
      `${basePrefix} CPU emulator variant B: repair assembler and vector-specific behavior. Focus on exact opcode/register/imm5/extension-word encoding, label address units, invalid-source rejection, mnemonic lookup performance, SIMD VADD/VSUB/VXOR lane wraparound, and SIMD flag stability. Keep already-passed scalar execution intact.`,
      `${basePrefix} CPU emulator plateau variant: improve hot paths without changing visible semantics. Use direct mnemonic dispatch, iterative execution, bounded memory, no recursion, and avoid per-instruction allocations.`
    ];
  } else if (family === "Dependency Attestation Admission Gate") {
    strategies = [
      `${basePrefix} Attestation gate variant A: repair attestation validity, stale detection, conflict handling, and waiver power. Explicitly decide observed_ts <= ts && ts < valid_until_ts, active mixed-status conflict, waiver covers missing/stale attestations but never blocks or rollout-disabled state, and keep audit fields deterministic.`,
      `${basePrefix} Attestation gate variant B: repair transitive dependency semantics. Traverse root plus all reachable dependencies with cycle-safe visited state; direct/transitive block denies regardless of waiver; each deficient dependency needs its own valid attestation or waiver; preserve root rollout semantics.`,
      `${basePrefix} Attestation gate scale variant: repair indexes and count paths. Avoid whole-world scans except over registered services; use service/env keyed state, adjacency lists, iterative graph traversal, timestamp pruning where safe, and preserve behavior/update checks.`
    ];
  } else if (family === "Session Credential Rotation Compat Registry") {
    strategies = [
      `${basePrefix} Session credential variant A: repair generation lifecycle. Focus on active vs staged generation, activation timestamp, grace_generation/grace_active boundaries, previous-generation compatibility, and revocation precedence over all grace windows.`,
      `${basePrefix} Session credential variant B: repair credential usability and audit. Credentials are immutable; session and per-generation revocation must be visible in audit; stale generations remain audit-visible but unusable when not compatible; count_active should reflect usable nonrevoked sessions per subject at ts.`,
      `${basePrefix} Session credential scale variant: index sessions by subject and credentials by session/generation; avoid scanning irrelevant credentials on hot check/audit/count paths.`
    ];
  } else if (family === "Trait Expression AST") {
    strategies = [
      `${basePrefix} Trait expression variant A: repair string-evaluation semantics. Preserve string interning identity, variable namespace validation, literal/var/email-local/regex-replace composition, invalid child propagation, and deep nested evaluation without recursion blowups.`,
      `${basePrefix} Trait expression variant B: repair matcher and audit semantics. Matchers evaluate child strings or caller-supplied matcher string, negate correctly, preserve last match truth in audit, populate exists/kind/evaluable/constant/namespace_error/matched/output_string_id deterministically.`,
      `${basePrefix} Trait expression scale variant: memoize expression evaluation per call where safe, use sparse id maps, and avoid dense id arrays or repeated full subtree work.`
    ];
  } else if (family === "Distributed Flag Snapshot Rollout Engine") {
    strategies = [
      `${basePrefix} Flag rollout variant A: repair snapshot/version semantics, stale reads, activation order, and fallback behavior. Preserve passed reads while fixing update bucket state transitions.`,
      `${basePrefix} Flag rollout variant B: repair targeting/count/audit consistency. Keep disabled or retired state distinct from missing state, and make explain/audit/count use the same resolution path.`,
      `${basePrefix} Flag rollout scale variant: index by flag/environment/segment, avoid scanning irrelevant snapshots, and preserve hot read complexity.`
    ];
  } else if (family === "Versioned Policy Rollout Engine") {
    strategies = [
      `${basePrefix} Policy rollout variant A: repair version lifecycle, staged/active policy selection, default/fallback rules, and timestamp boundary behavior.`,
      `${basePrefix} Policy rollout variant B: repair update and audit coherence. Ensure reads, explains, counts, and last_error all reflect the same policy resolution state after mutations.`,
      `${basePrefix} Policy rollout scale variant: index policies by scope/version/environment and avoid global scans on hot reads.`
    ];
  } else if (family === "Lua Bytecode VM") {
    strategies = [
      `${basePrefix} Lua VM variant A: repair instruction decode and stack/register semantics. Preserve public ABI, avoid panics, and make arithmetic/comparison/control-flow behavior coherent.`,
      `${basePrefix} Lua VM variant B: repair value/string/table/call behavior and error reporting. Keep memory ownership deterministic and do not special-case bucket labels.`,
      `${basePrefix} Lua VM scale variant: avoid per-step allocations, use compact value representations, and keep run loops iterative.`
    ];
  } else if (family === "Identity Bundle Auth Resolver") {
    strategies = [
      `${basePrefix} Identity resolver variant A: repair bundle membership, auth precedence, revocation/expiry, and override semantics.`,
      `${basePrefix} Identity resolver variant B: repair audit/count/explain coherence so every read path uses the same resolved identity state.`,
      `${basePrefix} Identity resolver scale variant: index identities, bundles, and environment/resource keys to avoid irrelevant scans.`
    ];
  }

  if (!strategies) return buildLevel3RepairStrategies(validation, options);

  const prioritized = prioritizeStrategies(strategies, failedText, options.plateau);
  return prioritized.slice(0, candidateCount);
}

function normalizeLevel3FamilyName(taskName: string): string {
  return taskName.trim();
}

function prioritizeStrategies(strategies: string[], failedText: string, plateau = false): string[] {
  const scored = strategies.map((strategy, index) => ({
    strategy,
    index,
    score: level3StrategyScore(strategy, failedText, plateau)
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.strategy);
}

function level3StrategyScore(strategy: string, failedText: string, plateau: boolean): number {
  const lowerStrategy = strategy.toLowerCase();
  const lowerFailed = failedText.toLowerCase();
  let score = 0;
  if (/scale|budget|benchmark|throughput/.test(lowerFailed) && /scale|performance|hot path|index|benchmark|throughput/.test(lowerStrategy)) {
    score += 5;
  }
  if (/update|mutation|stage|activate|disable|retire|lifecycle/.test(lowerFailed) && /update|lifecycle|stage|activate|state transition/.test(lowerStrategy)) {
    score += 4;
  }
  if (/assembler|label|mnemonic|decode/.test(lowerFailed) && /assembler|label|mnemonic|decode/.test(lowerStrategy)) {
    score += 6;
  }
  if (/simd|vector|vxor|vadd|vsub/.test(lowerFailed) && /simd|vector|vxor|vadd|vsub/.test(lowerStrategy)) {
    score += 5;
  }
  if (/stack|call|ret|wraparound|unaligned|flag|alu|cmp|branch/.test(lowerFailed) && /stack|call|ret|wraparound|flag|alu|cmp|branch|execution/.test(lowerStrategy)) {
    score += 4;
  }
  if (/waiver|attestation|stale|conflict/.test(lowerFailed) && /waiver|attestation|stale|conflict/.test(lowerStrategy)) {
    score += 5;
  }
  if (/dependency|transitive|block|graph|cycle/.test(lowerFailed) && /dependency|transitive|block|graph|cycle|traverse/.test(lowerStrategy)) {
    score += 5;
  }
  if (plateau && /plateau|scale|performance|hot path|index/.test(lowerStrategy)) score += 2;
  return score;
}

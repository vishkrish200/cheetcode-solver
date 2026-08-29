import { promises as fs } from "node:fs";
import path from "node:path";

import {
  listLevel3Candidates,
  normalizeLevel3CandidateCode,
  type Level3Candidate
} from "./candidates.js";
import { verifyLevel3Source } from "./local-verify.js";

export type Level3ComponentPreflightMode = "semantic" | "compile";

export interface Level3ComponentPreflightEntry {
  taskName: string;
  language: string;
  sourcePath: string;
  mode: Level3ComponentPreflightMode;
  ok: boolean;
  compileOk: boolean;
  semanticOk?: boolean;
  passed?: number;
  total?: number;
  error?: string;
}

export interface Level3ComponentPreflightSummary {
  total: number;
  passed: number;
  failed: number;
  semantic: number;
  compileOnly: number;
}

export interface Level3ComponentPreflightOptions {
  candidates?: readonly Level3Candidate[];
  includeUnverified?: boolean;
  runDir: string;
}

export function shouldRunLevel3ComponentSemanticVerification(taskName: string): boolean {
  return taskName === "16-bit CPU Emulator" || taskName === "Identity Bundle Auth Resolver";
}

export function selectLevel3ComponentPreflightCandidates(
  candidates: readonly Level3Candidate[] = listLevel3Candidates(),
  options: { includeUnverified?: boolean } = {}
): readonly Level3Candidate[] {
  if (options.includeUnverified) return candidates;
  return candidates.filter((candidate) => candidate.serverVerified === true);
}

export async function runLevel3ComponentPreflight(
  options: Level3ComponentPreflightOptions
): Promise<Level3ComponentPreflightEntry[]> {
  const candidates = selectLevel3ComponentPreflightCandidates(options.candidates, {
    includeUnverified: options.includeUnverified
  });
  await fs.mkdir(options.runDir, { recursive: true });

  const entries: Level3ComponentPreflightEntry[] = [];
  for (const candidate of candidates) {
    const sourcePath = path.resolve(candidate.sourcePath);
    const source = normalizeLevel3CandidateCode(await fs.readFile(sourcePath, "utf8"), candidate.language);
    const mode = shouldRunLevel3ComponentSemanticVerification(candidate.taskName) ? "semantic" : "compile";
    const label = safeLabel(`${candidate.taskName}-${candidate.language}`);
    const verification = await verifyLevel3Source(
      options.runDir,
      label,
      { taskName: candidate.taskName, language: candidate.language },
      source,
      { skipSemantic: mode === "compile" }
    );
    const semanticChecks = verification.semantic?.checks ?? [];
    entries.push({
      taskName: candidate.taskName,
      language: candidate.language,
      sourcePath: candidate.sourcePath,
      mode,
      ok: verification.ok,
      compileOk: verification.compile.ok,
      semanticOk: verification.semantic?.ok,
      passed: semanticChecks.length > 0 ? semanticChecks.filter((check) => check.ok).length : undefined,
      total: semanticChecks.length > 0 ? semanticChecks.length : undefined,
      error: verification.compile.error ?? verification.semantic?.error
    });
  }

  return entries;
}

export function summarizeLevel3ComponentPreflight(
  entries: readonly Level3ComponentPreflightEntry[]
): Level3ComponentPreflightSummary {
  return {
    total: entries.length,
    passed: entries.filter((entry) => entry.ok).length,
    failed: entries.filter((entry) => !entry.ok).length,
    semantic: entries.filter((entry) => entry.mode === "semantic").length,
    compileOnly: entries.filter((entry) => entry.mode === "compile").length
  };
}

export function safeLevel3ComponentPreflightLabel(value: string): string {
  return safeLabel(value);
}

function safeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

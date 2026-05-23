import path from "node:path";

import type { LocalCompileResult } from "./local-compile.js";
import type { Level3ValidationResponse } from "./types.js";

export interface ProbeCodeFile {
  label: string;
  path: string;
}

export interface Level3ValidationScore {
  compiled: boolean;
  passCount: number;
  totalCount: number;
  failCount: number;
  passedNames: string[];
  failedNames: string[];
}

export interface ProbeSubmissionSummary {
  label: string;
  localCompileOk: boolean;
  localCompile?: LocalCompileResult;
  validation?: Level3ValidationResponse;
  score?: Level3ValidationScore;
  sourcePath?: string;
}

export function parseProbeCodeFiles(value: string | undefined): ProbeCodeFile[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const equalsIndex = entry.indexOf("=");
      if (equalsIndex > 0) {
        const label = entry.slice(0, equalsIndex).trim();
        const filePath = entry.slice(equalsIndex + 1).trim();
        if (label && filePath) return { label, path: filePath };
      }
      return { label: labelFromPath(entry), path: entry };
    });
}

export function scoreLevel3Validation(
  validation: Level3ValidationResponse,
  expectedTotal?: number
): Level3ValidationScore {
  const compiled = validation.compiled !== false;
  const explicitPassCount = numberField(validation, "passCount");
  const explicitTotalCount = numberField(validation, "totalCount");
  const results = validation.results ?? [];
  const passCount = compiled ? explicitPassCount ?? results.filter((result) => result.correct).length : 0;
  const totalCount = explicitTotalCount ?? expectedTotal ?? results.length;
  const explicitFailCount = numberField(validation, "failCount");
  const failCount = explicitFailCount ?? Math.max(0, totalCount - passCount);

  const passedNames = results
    .filter((result) => result.correct)
    .map((result) => bucketName(result))
    .filter(Boolean);
  const failedNames = results
    .filter((result) => !result.correct)
    .map((result) => bucketName(result))
    .filter(Boolean);

  return {
    compiled,
    passCount,
    totalCount,
    failCount,
    passedNames,
    failedNames
  };
}

export function selectBestProbeResult<T extends ProbeSubmissionSummary>(results: T[]): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;

  for (const result of results) {
    const score = probeResultRank(result);
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return best;
}

export function sourceExtensionForLevel3Language(language: string): string {
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  if (language === "Rust") return "rs";
  return "txt";
}

export function slugProbeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";
}

function labelFromPath(filePath: string): string {
  const base = path.basename(filePath);
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function bucketName(result: { problemId: string; [key: string]: unknown }): string {
  const name = result.name;
  return typeof name === "string" && name.trim() ? name : result.problemId;
}

function probeResultRank(result: ProbeSubmissionSummary): number {
  if (!result.localCompileOk) return -1;
  if (!result.validation) return 0;
  const score = result.score ?? scoreLevel3Validation(result.validation);
  if (!score.compiled) return -1;
  return score.passCount;
}

import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { createLevel3Client } from "./level3/api.js";
import { listLevel3Candidates, normalizeLevel3CandidateCode, type Level3Candidate } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import { scoreLevel3Validation, slugProbeLabel } from "./level3/server-probe.js";
import type { Level3PreviewResponse, Level3Session } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

interface ScoreboardEntry {
  key: string;
  taskName: string;
  language: string;
  sourcePath: string;
  serverVerified: boolean;
  proofPath?: string;
  previewIndex?: number;
  status: "pending" | "compile-failed" | "server-error" | "mismatch" | "validated";
  compiled?: boolean;
  passCount?: number;
  totalCount?: number;
  failCount?: number;
  failedNames?: string[];
  runSourcePath?: string;
  validationPath?: string;
  error?: string;
}

async function main(): Promise<void> {
  const github = process.env.CHEETCODE_GITHUB ?? "trimax-eng";
  const maxPreviews = positiveInt(process.env.LEVEL3_SCOREBOARD_PREVIEWS, 260);
  const maxValidations = positiveInt(process.env.LEVEL3_SCOREBOARD_MAX_VALIDATIONS, 24);
  const includeVerified = process.env.LEVEL3_SCOREBOARD_INCLUDE_VERIFIED !== "0";
  const runDir = await createRunDir("level3-scoreboard-probe");
  const client = await createLevel3Client();
  const candidates = listLevel3Candidates().filter((candidate) => includeVerified || candidate.serverVerified !== true);
  const pending = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const entries = new Map<string, ScoreboardEntry>();
  const previews: Level3PreviewResponse[] = [];
  let validations = 0;

  for (const candidate of candidates) {
    entries.set(candidateKey(candidate), {
      key: candidateKey(candidate),
      taskName: candidate.taskName,
      language: candidate.language,
      sourcePath: candidate.sourcePath,
      serverVerified: candidate.serverVerified === true,
      proofPath: candidate.proofPath,
      status: "pending"
    });
  }

  for (let index = 1; index <= maxPreviews && pending.size > 0 && validations < maxValidations; index += 1) {
    const preview = await client.preview();
    previews.push(preview);
    const key = `${preview.taskName} [${preview.language}]`;
    console.log(`${String(index).padStart(3, "0")}. ${key}`);
    const candidate = pending.get(key);
    if (!candidate) continue;

    pending.delete(key);
    validations += 1;
    const entry = entries.get(key);
    if (!entry) continue;
    entry.previewIndex = index;
    await probeCandidate({
      candidate,
      entry,
      client,
      preview,
      runDir,
      github,
      ordinal: validations
    });
    if (entry.status === "mismatch") {
      pending.set(key, candidate);
      validations -= 1;
    }
  }

  await writeJson(path.join(runDir, "previews.json"), previews);
  const summary = buildSummary([...entries.values()]);
  await writeJson(path.join(runDir, "summary.json"), summary);
  printSummary(summary);
  console.log(`Level 3 scoreboard artifacts: ${runDir}`);
}

async function probeCandidate(args: {
  candidate: Level3Candidate;
  entry: ScoreboardEntry;
  client: Awaited<ReturnType<typeof createLevel3Client>>;
  preview: Level3PreviewResponse;
  runDir: string;
  github: string;
  ordinal: number;
}): Promise<void> {
  const { candidate, entry, client, preview, runDir, github, ordinal } = args;
  const label = `${String(ordinal).padStart(2, "0")}-${slugProbeLabel(entry.key)}`;
  try {
    const rawSource = await fs.readFile(path.resolve(candidate.sourcePath), "utf8");
    const code = normalizeLevel3CandidateCode(rawSource, candidate.language);
    const sourcePath = path.join(runDir, `${label}.${sourceExtension(candidate.language)}`);
    await fs.writeFile(sourcePath, code);
    entry.runSourcePath = sourcePath;

    const compile = await compileLevel3Source(runDir, label, candidate.language, code);
    await writeJson(path.join(runDir, `${label}-local-compile.json`), compile);
    if (!compile.ok) {
      entry.status = "compile-failed";
      entry.error = compile.error ?? "local compile failed";
      console.log(`  ${entry.key}: local compile failed`);
      return;
    }

    const session = await client.startSession(preview.previewToken);
    await writeJson(path.join(runDir, `${label}-session.json`), session);
    const challenge = session.problems[0];
    if (!challenge || challenge.taskName !== candidate.taskName || challenge.language !== candidate.language) {
      entry.status = "mismatch";
      entry.error = challenge
        ? `restored ${challenge.taskName} [${challenge.language}]`
        : "session returned no Level 3 challenge";
      await finishRestoredSession(client, session, challenge?.starterCode ?? "", github);
      console.log(`  ${entry.key}: session mismatch (${entry.error})`);
      return;
    }

    const validation = await client.validateCode(session.sessionId, challenge.id, code);
    const validationPath = path.join(runDir, `${label}-validation.json`);
    await writeJson(validationPath, validation);
    const score = scoreLevel3Validation(validation, challenge.checks.length);
    entry.status = "validated";
    entry.compiled = score.compiled;
    entry.passCount = score.passCount;
    entry.totalCount = score.totalCount;
    entry.failCount = score.failCount;
    entry.failedNames = score.failedNames;
    entry.validationPath = validationPath;
    await finishRestoredSession(client, session, code, github);
    console.log(`  ${entry.key}: compiled=${score.compiled} pass=${score.passCount}/${score.totalCount}`);
  } catch (error) {
    entry.status = "server-error";
    entry.error = error instanceof Error ? error.message : String(error);
    console.log(`  ${entry.key}: error: ${entry.error}`);
  }
}

function buildSummary(entries: ScoreboardEntry[]): { entries: ScoreboardEntry[]; byStatus: Record<string, number> } {
  const sorted = entries.sort((a, b) => {
    const scoreA = a.passCount ?? -1;
    const scoreB = b.passCount ?? -1;
    return scoreB - scoreA || a.key.localeCompare(b.key);
  });
  const byStatus: Record<string, number> = {};
  for (const entry of sorted) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  }
  return { entries: sorted, byStatus };
}

function printSummary(summary: { entries: ScoreboardEntry[]; byStatus: Record<string, number> }): void {
  console.log("Level 3 candidate scoreboard:");
  for (const entry of summary.entries) {
    const score = entry.passCount === undefined ? entry.status : `${entry.passCount}/${entry.totalCount}`;
    console.log(`${score.padEnd(14)} ${entry.key}`);
    if (entry.failedNames?.length) {
      console.log(`  failed: ${entry.failedNames.join(" | ")}`);
    }
    if (entry.error) {
      console.log(`  error: ${entry.error}`);
    }
  }
}

async function finishRestoredSession(
  client: Awaited<ReturnType<typeof createLevel3Client>>,
  session: Pick<Level3Session, "sessionId" | "startedAt">,
  code: string,
  github: string
): Promise<void> {
  await client.finishSession(session, code, github, 120_000).catch(() => undefined);
}

function candidateKey(candidate: Pick<Level3Candidate, "taskName" | "language">): string {
  return `${candidate.taskName} [${candidate.language}]`;
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

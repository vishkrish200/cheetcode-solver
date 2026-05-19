import { promises as fs } from "node:fs";
import path from "node:path";

import { listLevel3Candidates } from "./level3/candidates.js";
import { OUTPUT_ROOT } from "./recon/capture.js";

interface PairInfo {
  taskName: string;
  language: string;
  previewCount: number;
  sessionPaths: string[];
  candidatePath?: string;
}

async function main(): Promise<void> {
  const pairs = new Map<string, PairInfo>();
  await addPreviewPairs(pairs);
  await addSessionPairs(pairs);
  addCandidatePairs(pairs);

  const sorted = [...pairs.values()].sort(
    (a, b) => Number(Boolean(b.candidatePath)) - Number(Boolean(a.candidatePath)) || key(a).localeCompare(key(b))
  );
  const covered = sorted.filter((pair) => pair.candidatePath).length;
  console.log(`Level 3 candidate coverage: ${covered}/${sorted.length} observed pair(s)`);

  for (const pair of sorted) {
    const status = pair.candidatePath ? "COVERED" : "MISSING";
    const sessions = pair.sessionPaths.length > 0 ? `${pair.sessionPaths.length} session(s)` : "no session";
    const previews = pair.previewCount > 0 ? `${pair.previewCount} preview(s)` : "no preview";
    console.log(`${status.padEnd(7)} ${key(pair)} - ${previews}, ${sessions}`);
  }
}

async function addPreviewPairs(pairs: Map<string, PairInfo>): Promise<void> {
  const files = await findFiles(OUTPUT_ROOT, "previews.json");
  for (const file of files) {
    const previews = JSON.parse(await fs.readFile(file, "utf8")) as Array<{ taskName?: string; language?: string }>;
    for (const preview of previews) {
      if (!preview.taskName || !preview.language) continue;
      const pair = ensurePair(pairs, preview.taskName, preview.language);
      pair.previewCount += 1;
    }
  }
}

async function addSessionPairs(pairs: Map<string, PairInfo>): Promise<void> {
  const files = await findFiles(OUTPUT_ROOT, "session.json");
  for (const file of files) {
    const session = JSON.parse(await fs.readFile(file, "utf8")) as {
      level?: number;
      problems?: Array<{ taskName?: string; language?: string }>;
    };
    if (session.level !== 3) continue;
    const problem = session.problems?.[0];
    if (!problem?.taskName || !problem.language) continue;
    ensurePair(pairs, problem.taskName, problem.language).sessionPaths.push(file);
  }
}

function addCandidatePairs(pairs: Map<string, PairInfo>): void {
  for (const candidate of listLevel3Candidates()) {
    ensurePair(pairs, candidate.taskName, candidate.language).candidatePath = candidate.sourcePath;
  }
}

async function findFiles(root: string, filename: string): Promise<string[]> {
  const matches: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === filename) {
        matches.push(fullPath);
      }
    }
  };
  await walk(root);
  return matches.sort();
}

function ensurePair(pairs: Map<string, PairInfo>, taskName: string, language: string): PairInfo {
  const pairKey = `${taskName} [${language}]`;
  const existing = pairs.get(pairKey);
  if (existing) return existing;

  const created: PairInfo = {
    taskName,
    language,
    previewCount: 0,
    sessionPaths: []
  };
  pairs.set(pairKey, created);
  return created;
}

function key(pair: Pick<PairInfo, "taskName" | "language">): string {
  return `${pair.taskName} [${pair.language}]`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

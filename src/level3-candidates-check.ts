import { promises as fs } from "node:fs";
import path from "node:path";

import { listLevel3Candidates, normalizeLevel3CandidateCode } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";

async function main(): Promise<void> {
  const candidates = listLevel3Candidates();
  if (candidates.length === 0) {
    console.log("No Level 3 candidates registered.");
    return;
  }

  let failed = 0;
  for (const candidate of candidates) {
    const sourcePath = path.resolve(candidate.sourcePath);
    const source = normalizeLevel3CandidateCode(await fs.readFile(sourcePath, "utf8"), candidate.language);
    const runDir = path.dirname(sourcePath);
    const label = safeLabel(`${candidate.taskName}-${candidate.language}`);
    const result = await compileLevel3Source(runDir, `registry-${label}`, candidate.language, source);
    const name = `${candidate.taskName} [${candidate.language}]`;
    if (result.ok) {
      console.log(`PASS ${name}`);
      continue;
    }

    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(result.error ?? "unknown compile error");
  }

  if (failed > 0) {
    throw new Error(`${failed}/${candidates.length} registered Level 3 candidate(s) failed local compile.`);
  }

  console.log(`All ${candidates.length} registered Level 3 candidate(s) compiled locally.`);
}

function safeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

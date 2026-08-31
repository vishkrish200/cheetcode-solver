import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { listLevel3Candidates, normalizeLevel3CandidateCode } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";

export async function checkLevel3Candidates(): Promise<void> {
  const candidates = listLevel3Candidates();
  if (candidates.length === 0) {
    console.log("No Level 3 candidates registered.");
    return;
  }

  const runDir = await fs.mkdtemp(path.join(tmpdir(), "cheetcode-level3-candidates-"));
  console.log(`Local compile artifacts: ${runDir}`);
  let failed = 0;
  for (const candidate of candidates) {
    const sourceUrl = new URL(`../${candidate.sourcePath}`, import.meta.url);
    const source = normalizeLevel3CandidateCode(await fs.readFile(sourceUrl, "utf8"), candidate.language);
    const label = safeLabel(`${candidate.taskName}-${candidate.language === "C++" ? "cpp" : candidate.language}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkLevel3Candidates().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

import path from "node:path";

import { loadEnvFile } from "./env.js";
import { writeJson } from "./level1/api.js";
import {
  runLevel3ComponentPreflight,
  summarizeLevel3ComponentPreflight
} from "./level3/component-preflight.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

async function main(): Promise<void> {
  const runDir = await createRunDir("level3-component-preflight");
  const entries = await runLevel3ComponentPreflight({
    runDir,
    includeUnverified: process.env.LEVEL3_COMPONENT_PREFLIGHT_INCLUDE_UNVERIFIED === "1"
  });
  const summary = summarizeLevel3ComponentPreflight(entries);

  await writeJson(path.join(runDir, "component-preflight.json"), { summary, entries });

  for (const entry of entries) {
    const detail =
      entry.mode === "semantic" && entry.total !== undefined
        ? ` ${entry.passed}/${entry.total} local checks`
        : "";
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.taskName} [${entry.language}] (${entry.mode})${detail}`);
    if (!entry.ok && entry.error) console.error(entry.error.split(/\r?\n/)[0]);
  }

  console.log(
    `Level 3 component preflight: ${summary.passed}/${summary.total} passed (${summary.semantic} semantic, ${summary.compileOnly} compile-only).`
  );
  console.log(`Artifacts: ${runDir}`);

  if (summary.failed > 0) {
    throw new Error(`${summary.failed}/${summary.total} Level 3 component(s) failed preflight.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

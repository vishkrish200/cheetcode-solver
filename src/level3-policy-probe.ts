import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { allLevel3ChecksPassed, createLevel3Client } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import type { Level3Challenge } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

interface ProbeVariant {
  label: string;
  code: string;
}

const TARGET_TASK = process.env.LEVEL3_PROBE_TASK ?? "Versioned Policy Rollout Engine";
const TARGET_LANGUAGE = process.env.LEVEL3_PROBE_LANGUAGE ?? "Rust";

async function main(): Promise<void> {
  const client = await createLevel3Client();
  const runDir = await createRunDir("level3-policy-probe");
  const previewLimit = Number(process.env.LEVEL3_PROBE_PREVIEW_LIMIT ?? 150);

  let selectedPreview: Awaited<ReturnType<typeof client.preview>> | undefined;
  const previews = [];
  for (let index = 1; index <= previewLimit; index += 1) {
    const preview = await client.preview();
    previews.push(preview);
    console.log(`${String(index).padStart(3, "0")}. ${preview.taskName} [${preview.language}]`);
    if (preview.taskName === TARGET_TASK && preview.language === TARGET_LANGUAGE) {
      selectedPreview = preview;
      break;
    }
  }
  await writeJson(path.join(runDir, "previews.json"), previews);
  if (!selectedPreview) {
    throw new Error(`Did not see ${TARGET_TASK} [${TARGET_LANGUAGE}] in ${previewLimit} previews. Artifacts: ${runDir}`);
  }

  await writeJson(path.join(runDir, "preview.json"), selectedPreview);
  const session = await client.startSession(selectedPreview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) throw new Error("Level 3 session did not include a challenge.");
  if (challenge.taskName !== TARGET_TASK || challenge.language !== TARGET_LANGUAGE) {
    await writeJson(path.join(runDir, "restored-session-mismatch.json"), {
      requested: { taskName: TARGET_TASK, language: TARGET_LANGUAGE },
      preview: selectedPreview,
      restored: { taskName: challenge.taskName, language: challenge.language, id: challenge.id }
    });
    await client.finishSession(session, challenge.starterCode ?? "", process.env.CHEETCODE_GITHUB ?? "trimax-eng", 120_000).catch(
      () => undefined
    );
    throw new Error(
      `Server restored active ${challenge.taskName} [${challenge.language}] instead of requested ${TARGET_TASK} [${TARGET_LANGUAGE}]. Cleared it; rerun the probe. Artifacts: ${runDir}`
    );
  }
  console.log(`Started ${challenge.taskName} [${challenge.language}], expiresAt=${session.expiresAt}`);

  const variants = await buildVariants(challenge);
  const summary = [];
  let lastCode = challenge.starterCode ?? "";
  for (const [index, variant] of variants.entries()) {
    lastCode = variant.code;
    const label = `${String(index + 1).padStart(2, "0")}-${slug(variant.label)}`;
    const codePath = path.join(runDir, `${label}.${sourceExtension(challenge.language)}`);
    await fs.writeFile(codePath, variant.code);

    const localCompile = await compileLevel3Source(runDir, label, challenge.language, variant.code);
    await writeJson(path.join(runDir, `${label}-local-compile.json`), localCompile);
    if (!localCompile.ok) {
      console.log(`${variant.label}: local compile failed`);
      summary.push({ label: variant.label, localCompile });
      continue;
    }

    const validation = await client.validateCode(session.sessionId, challenge.id, variant.code);
    await writeJson(path.join(runDir, `${label}-validation.json`), validation);
    const passCount =
      typeof validation.passCount === "number"
        ? validation.passCount
        : validation.results.filter((result) => result.correct).length;
    console.log(`${variant.label}: compiled=${validation.compiled !== false} pass=${passCount}/${challenge.checks.length}`);
    summary.push({ label: variant.label, localCompile, validation });
    if (allLevel3ChecksPassed(validation, challenge.checks.length)) break;
  }

  const finish = await client.finishSession(session, lastCode, process.env.CHEETCODE_GITHUB ?? "trimax-eng", 120_000).catch(
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
  );
  await writeJson(path.join(runDir, "finish-result.json"), finish);
  await writeJson(path.join(runDir, "summary.json"), summary);
  console.log(`Policy probe artifacts: ${runDir}`);
}

async function buildVariants(challenge: Level3Challenge): Promise<ProbeVariant[]> {
  const variants: ProbeVariant[] = [];
  const registered = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
  if (registered) {
    variants.push({ label: "registered", code: registered });
    variants.push({ label: "registered-success1", code: firstSuccessReturns(registered, "1", 6) });
  }

  const manualV2Path = path.resolve("recon-output/manual-candidates/policy-rust-v2/policy_candidate.rs");
  const manualV2 = await fs.readFile(manualV2Path, "utf8");
  variants.push({ label: "manual-v2", code: manualV2 });
  variants.push({ label: "manual-v2-success0", code: firstSuccessReturns(manualV2, "0", 6) });
  variants.push({ label: "manual-v2-any-allowed-bit", code: manualV2.replace("(snapshot.allow_mask & perm_bit) == perm_bit", "(snapshot.allow_mask & perm_bit) != 0") });
  variants.push({ label: "manual-v2-global-deny", code: withGlobalDenyOverride(manualV2) });
  return variants;
}

function firstSuccessReturns(code: string, replacement: "0" | "1", limit: number): string {
  let changed = 0;
  return code.replace(/(self\.clear_error\(\);\n\s*)[01](\n\s*})/g, (match, prefix: string, suffix: string) => {
    if (changed >= limit) return match;
    changed += 1;
    return `${prefix}${replacement}${suffix}`;
  });
}

function withGlobalDenyOverride(code: string): string {
  return code
    .replace("let mut top_priority: Option<i32> = None;", "let mut top_priority: Option<i32> = None;\n    let mut global_best_deny: Option<&Snapshot> = None;")
    .replace(
      "if (snapshot.deny_mask & perm_bit) != 0 {\n            if best_deny.map_or(true, |current| better(snapshot, current)) {\n                best_deny = Some(snapshot);\n            }\n        } else if (snapshot.allow_mask & perm_bit) == perm_bit {",
      "if (snapshot.deny_mask & perm_bit) != 0 {\n            if global_best_deny.map_or(true, |current| better(snapshot, current)) {\n                global_best_deny = Some(snapshot);\n            }\n            if best_deny.map_or(true, |current| better(snapshot, current)) {\n                best_deny = Some(snapshot);\n            }\n        } else if (snapshot.allow_mask & perm_bit) == perm_bit {"
    )
    .replace(
      "if let Some(snapshot) = best_deny {\n        inspection.chosen = Some(snapshot.snapshot_id);\n        inspection.allowed = false;",
      "if let Some(snapshot) = global_best_deny {\n        inspection.chosen = Some(snapshot.snapshot_id);\n        inspection.allowed = false;\n    } else if let Some(snapshot) = best_deny {\n        inspection.chosen = Some(snapshot.snapshot_id);\n        inspection.allowed = false;"
    );
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

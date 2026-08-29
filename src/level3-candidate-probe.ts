import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { allLevel3ChecksPassed, createLevel3Client } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import { writeJson } from "./level1/api.js";
import { resolveGithubIdentity } from "./identity.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

const TARGET_TASK = process.env.LEVEL3_PROBE_TASK;
const TARGET_LANGUAGE = process.env.LEVEL3_PROBE_LANGUAGE;
const TARGET_CODE_FILE = process.env.LEVEL3_PROBE_CODE_FILE;

async function main(): Promise<void> {
  if (!TARGET_TASK || !TARGET_LANGUAGE) {
    throw new Error("Set LEVEL3_PROBE_TASK and LEVEL3_PROBE_LANGUAGE.");
  }

  const client = await createLevel3Client();
  const runDir = await createRunDir("level3-candidate-probe");
  const previewLimit = Number(process.env.LEVEL3_PROBE_PREVIEW_LIMIT ?? 150);
  const previews = [];
  let selectedPreview: Awaited<ReturnType<typeof client.preview>> | undefined;

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
    await client.finishSession(session, challenge.starterCode ?? "", resolveGithubIdentity(), 120_000).catch(
      () => undefined
    );
    throw new Error(
      `Server restored active ${challenge.taskName} [${challenge.language}] instead of requested ${TARGET_TASK} [${TARGET_LANGUAGE}]. Cleared it; rerun the probe. Artifacts: ${runDir}`
    );
  }

  const code = TARGET_CODE_FILE
    ? await fs.readFile(path.resolve(TARGET_CODE_FILE), "utf8")
    : await loadLevel3CandidateCode(challenge.taskName, challenge.language, { allowUnverified: true });
  if (!code) throw new Error(`No registered candidate for ${challenge.taskName} [${challenge.language}].`);

  const codePath = path.join(runDir, `candidate.${sourceExtension(challenge.language)}`);
  await fs.writeFile(codePath, code);
  const localCompile = await compileLevel3Source(runDir, "candidate", challenge.language, code);
  await writeJson(path.join(runDir, "candidate-local-compile.json"), localCompile);
  if (!localCompile.ok) {
    console.log(`Local compile failed. Artifacts: ${runDir}`);
    return;
  }

  const validation = await client.validateCode(session.sessionId, challenge.id, code);
  await writeJson(path.join(runDir, "candidate-validation.json"), validation);
  const finish = await client.finishSession(session, code, resolveGithubIdentity(), 120_000).catch(
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
  );
  await writeJson(path.join(runDir, "finish-result.json"), finish);
  const passed = allLevel3ChecksPassed(validation, challenge.checks.length);
  const passCount =
    typeof validation.passCount === "number"
      ? validation.passCount
      : validation.results.filter((result) => result.correct).length;
  console.log(
    `Candidate ${passed ? "passed" : "failed"}: compiled=${validation.compiled !== false}, pass=${passCount}/${challenge.checks.length}`
  );
  console.log(`Candidate probe artifacts: ${runDir}`);
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { allLevel3ChecksPassed, createLevel3Client, type Level3Client } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { compileLevel3Source } from "./level3/local-compile.js";
import { resolveLevel3PreviewOverride } from "./level3/preview-override.js";
import {
  parseProbeCodeFiles,
  scoreLevel3Validation,
  selectBestProbeResult,
  slugProbeLabel,
  sourceExtensionForLevel3Language,
  type ProbeCodeFile,
  type ProbeSubmissionSummary
} from "./level3/server-probe.js";
import type { Level3Challenge, Level3PreviewResponse, Level3Session } from "./level3/types.js";
import { writeJson } from "./level1/api.js";
import { createRunDir } from "./recon/capture.js";

loadEnvFile();

interface ProbeVariant {
  label: string;
  code: string;
  sourcePath?: string;
}

interface ProbeSummary extends ProbeSubmissionSummary {
  validationError?: string;
}

async function main(): Promise<void> {
  const github = process.env.CHEETCODE_GITHUB ?? "trimax-eng";
  const runDir = await createRunDir("level3-server-probe");
  const client = await createLevel3Client();
  const targetTask = process.env.LEVEL3_PROBE_TASK?.trim();
  const targetLanguage = process.env.LEVEL3_PROBE_LANGUAGE?.trim();

  const selectedPreview = await selectPreview(client, runDir, targetTask, targetLanguage);
  const preloadedVariants = await loadProbeVariants(selectedPreview);
  if (preloadedVariants.length === 0) {
    throw new Error(
      "No probe candidates configured. Set LEVEL3_PROBE_CODE_FILES=label=path/to/code.c or LEVEL3_PROBE_USE_REGISTERED=1."
    );
  }

  await writeJson(path.join(runDir, "preview.json"), selectedPreview);
  const session = await client.startSession(selectedPreview.previewToken);
  await writeJson(path.join(runDir, "session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) {
    throw new Error("Level 3 session did not include a challenge.");
  }
  if (!challengeMatchesTarget(challenge, targetTask, targetLanguage)) {
    await finishProbeSession(client, session, challenge.starterCode ?? "", github, runDir, "restored-session-mismatch");
    throw new Error(
      `Server restored active ${challenge.taskName} [${challenge.language}] instead of requested ${targetTask ?? "*"} [${
        targetLanguage ?? "*"
      }]. Cleared it; rerun the probe. Artifacts: ${runDir}`
    );
  }

  console.log(`Started ${challenge.taskName} [${challenge.language}]`);
  const summaries: ProbeSummary[] = [];
  let lastSubmittedCode = challenge.starterCode ?? "";

  for (const [index, variant] of preloadedVariants.entries()) {
    const label = `${String(index + 1).padStart(2, "0")}-${slugProbeLabel(variant.label)}`;
    const sourcePath = path.join(runDir, `${label}.${sourceExtensionForLevel3Language(challenge.language)}`);
    await fs.writeFile(sourcePath, variant.code);

    const localCompile = await compileLevel3Source(runDir, label, challenge.language, variant.code);
    await writeJson(path.join(runDir, `${label}-local-compile.json`), localCompile);
    const summary: ProbeSummary = {
      label: variant.label,
      localCompileOk: localCompile.ok,
      localCompile,
      sourcePath: variant.sourcePath ?? sourcePath
    };

    if (!localCompile.ok) {
      console.log(`${variant.label}: local compile failed`);
      summaries.push(summary);
      continue;
    }

    try {
      const validation = await client.validateCode(session.sessionId, challenge.id, variant.code);
      const score = scoreLevel3Validation(validation, challenge.checks.length);
      await writeJson(path.join(runDir, `${label}-validation.json`), validation);
      summary.validation = validation;
      summary.score = score;
      lastSubmittedCode = variant.code;
      console.log(`${variant.label}: compiled=${score.compiled} pass=${score.passCount}/${score.totalCount}`);
      summaries.push(summary);

      if (allLevel3ChecksPassed(validation, challenge.checks.length)) {
        break;
      }
    } catch (error) {
      summary.validationError = error instanceof Error ? error.message : String(error);
      console.log(`${variant.label}: server validation error: ${summary.validationError}`);
      summaries.push(summary);
    }
  }

  const best = selectBestProbeResult(summaries);
  await writeJson(path.join(runDir, "summary.json"), {
    target: {
      taskName: targetTask,
      language: targetLanguage
    },
    challenge: {
      id: challenge.id,
      taskName: challenge.taskName,
      language: challenge.language,
      checks: challenge.checks
    },
    best: best
      ? {
          label: best.label,
          localCompileOk: best.localCompileOk,
          score: best.score,
          sourcePath: best.sourcePath
        }
      : undefined,
    variants: summaries
  });

  const finishCode = best?.validation && best.localCompileOk ? await readBestCode(runDir, preloadedVariants, best.label) : lastSubmittedCode;
  await finishProbeSession(client, session, finishCode, github, runDir, "finish-result");
  console.log(`Level 3 server probe artifacts: ${runDir}`);
  if (best?.score) {
    console.log(`Best: ${best.label} ${best.score.passCount}/${best.score.totalCount}`);
  }
}

async function selectPreview(
  client: Level3Client,
  runDir: string,
  targetTask: string | undefined,
  targetLanguage: string | undefined
): Promise<Level3PreviewResponse> {
  const override = resolveLevel3PreviewOverride(process.env);
  if (override) return override;

  const previews: Level3PreviewResponse[] = [];
  const limit = Math.max(1, Number(process.env.LEVEL3_PROBE_PREVIEW_LIMIT ?? 80));
  for (let index = 1; index <= limit; index += 1) {
    const preview = await client.preview();
    previews.push(preview);
    console.log(`${String(index).padStart(3, "0")}. ${preview.taskName} [${preview.language}]`);
    if (previewMatchesTarget(preview, targetTask, targetLanguage)) {
      await writeJson(path.join(runDir, "previews.json"), previews);
      return preview;
    }
  }

  await writeJson(path.join(runDir, "previews.json"), previews);
  throw new Error(`Did not see requested Level 3 preview in ${limit} samples. Artifacts: ${runDir}`);
}

async function loadProbeVariants(preview: Level3PreviewResponse): Promise<ProbeVariant[]> {
  const variants: ProbeVariant[] = [];
  const codeFiles = parseProbeCodeFiles(process.env.LEVEL3_PROBE_CODE_FILES ?? process.env.LEVEL3_CODE_FILE);
  for (const codeFile of codeFiles) {
    variants.push(await readProbeCodeFile(codeFile));
  }

  if (process.env.LEVEL3_PROBE_USE_REGISTERED === "1") {
    const code = await loadLevel3CandidateCode(preview.taskName, preview.language, {
      allowUnverified: process.env.LEVEL3_PROBE_ALLOW_UNVERIFIED_REGISTERED === "1"
    });
    if (code) {
      variants.push({ label: "registered", code });
    }
  }

  return variants;
}

async function readProbeCodeFile(codeFile: ProbeCodeFile): Promise<ProbeVariant> {
  const absolutePath = path.resolve(codeFile.path);
  return {
    label: codeFile.label,
    code: await fs.readFile(absolutePath, "utf8"),
    sourcePath: absolutePath
  };
}

function previewMatchesTarget(
  preview: Level3PreviewResponse,
  targetTask: string | undefined,
  targetLanguage: string | undefined
): boolean {
  return (!targetTask || preview.taskName === targetTask) && (!targetLanguage || preview.language === targetLanguage);
}

function challengeMatchesTarget(
  challenge: Level3Challenge,
  targetTask: string | undefined,
  targetLanguage: string | undefined
): boolean {
  return (!targetTask || challenge.taskName === targetTask) && (!targetLanguage || challenge.language === targetLanguage);
}

async function readBestCode(runDir: string, variants: ProbeVariant[], bestLabel: string): Promise<string> {
  const variant = variants.find((candidate) => candidate.label === bestLabel);
  if (variant) return variant.code;

  const summaries = JSON.parse(await fs.readFile(path.join(runDir, "summary.json"), "utf8")) as {
    best?: { sourcePath?: string };
  };
  if (summaries.best?.sourcePath) return fs.readFile(summaries.best.sourcePath, "utf8");
  return "";
}

async function finishProbeSession(
  client: Level3Client,
  session: Level3Session,
  code: string,
  github: string,
  runDir: string,
  label: string
): Promise<void> {
  if (process.env.LEVEL3_PROBE_SKIP_FINISH === "1") return;
  const finish = await client.finishSession(session, code, github, 120_000).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error)
  }));
  await writeJson(path.join(runDir, `${label}.json`), finish);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

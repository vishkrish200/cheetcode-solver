import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvFile } from "./env.js";
import { resolveGithubIdentity } from "./identity.js";
import { requireLlmConfig } from "./llm/client.js";
import { createLevel3Client, allLevel3ChecksPassed, type Level3Client } from "./level3/api.js";
import { loadLevel3CandidateCode } from "./level3/candidates.js";
import { generateLevel3VerifierWithLlm } from "./level3/dynamic-verifier.js";
import {
  solveLevel3WithLlmDetailed,
  type Level3LlmSolveResult,
  type Level3RenderedContext
} from "./level3/llm.js";
import { verifyLevel3Source, type Level3LocalVerificationResult } from "./level3/local-verify.js";
import {
  buildLevel3CompileRepairFeedback,
  buildLevel3FamilyRepairStrategies,
  buildLevel3RepairFeedback,
  countLevel3Passes,
  shouldStopAfterZeroPassPlateau,
  shouldRepairBeforeServerValidation,
  shouldRunLevel3LocalSemantics,
  shouldValidateCurrentCodeAfterMissingRepair
} from "./level3/run-policy.js";
import { resolveLevel3PreviewOverride } from "./level3/preview-override.js";
import {
  DEFAULT_LEVEL3_SOLVER_MODE,
  parseLevel3SolverMode,
  shouldUseLevel3RegisteredCandidate
} from "./level3/solver-mode.js";
import { solveTraitExpressionTask } from "./level3/specialists/trait-expression.js";
import { renderLevel3FamilyTemplate } from "./level3/templates/index.js";
import type { Level3Challenge, Level3Session, Level3ValidationResponse } from "./level3/types.js";
import { startLevel3SessionViaUi } from "./level3/ui-session.js";
import { writeJson } from "./level1/api.js";
import { OUTPUT_ROOT, createRunDir } from "./recon/capture.js";

loadEnvFile();

const command = process.argv[2] ?? "run";

async function main(): Promise<void> {
  switch (command) {
    case "preview":
      await previewLevel3();
      return;
    case "run":
      await runLevel3();
      return;
    case "catalog":
      await catalogLevel3();
      return;
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown level3 command: ${command}`);
  }
}

async function catalogLevel3(): Promise<void> {
  const samples = Number(process.env.LEVEL3_CATALOG_SAMPLES ?? 12);
  const runDir = await createRunDir("level3-catalog");
  const client = await createLevel3Client();
  const previews = [];

  for (let index = 0; index < samples; index += 1) {
    const preview = await client.preview();
    previews.push(preview);
    console.log(`${String(index + 1).padStart(2, "0")}. ${preview.taskName} in ${preview.language}`);
  }

  await writeJson(path.join(runDir, "previews.json"), previews);
  const counts: Record<string, number> = {};
  for (const preview of previews) {
    const key = `${preview.taskName} [${preview.language}]`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  await writeJson(path.join(runDir, "summary.json"), counts);
  console.log(`Level 3 catalog artifacts: ${runDir}`);
}

async function previewLevel3(): Promise<void> {
  const runDir = await createRunDir("level3-preview");
  const client = await createLevel3Client();
  const preview = resolveLevel3PreviewOverride(process.env) ?? (await client.preview());
  await writeJson(path.join(runDir, "preview.json"), preview);

  console.log(`Level 3 preview artifacts: ${runDir}`);
  console.log(`${preview.taskName} in ${preview.language}`);
  console.log(`challengeId: ${preview.challengeId}`);
  console.log(`previewToken: ${preview.previewToken}`);
}

async function runLevel3(): Promise<void> {
  const github = resolveGithubIdentity();
  const runDir = await createRunDir("level3-attempt");
  const startedAt = Date.now();

  if (process.env.LEVEL3_SPEED_DEMON === "1") {
    await runLevel3SpeedDemon(runDir, github, startedAt);
    return;
  }

  const solverMode = parseLevel3SolverMode(process.env.LEVEL3_SOLVER_MODE);
  const sessionStartMode = parseSessionStartMode(process.env.LEVEL3_SESSION_START_MODE ?? "api");
  if (!process.env.LEVEL3_CODE_FILE && solverMode === "dynamic") {
    requireLlmConfig("level3");
  }

  let client = await createLevel3Client();
  let renderedContext: Level3RenderedContext = {};
  let session: Level3Session;
  if (sessionStartMode === "ui") {
    const uiStart = await startLevel3SessionViaUi(runDir);
    session = uiStart.session;
    renderedContext = uiStart.renderedContext;
    if (uiStart.fingerprintId) {
      client = await createLevel3Client({ fingerprintId: uiStart.fingerprintId });
    }
  } else {
    const preview = resolveLevel3PreviewOverride(process.env) ?? (await client.preview());
    await writeJson(path.join(runDir, "preview.json"), preview);
    session = await client.startSession(preview.previewToken);
  }
  await writeJson(path.join(runDir, "session.json"), session);

  const challenge = session.problems[0];
  if (!challenge) {
    throw new Error("Level 3 session did not include a challenge payload.");
  }

  const runLocalSemantics = shouldRunLevel3LocalSemantics(process.env);
  const generatedVerifierSource = runLocalSemantics ? await maybeGenerateLocalVerifier(runDir, challenge) : undefined;
  let code = await loadInitialCode(runDir, challenge, renderedContext);
  await fs.writeFile(path.join(runDir, `attempt-00.${sourceExtension(challenge.language)}`), code);

  const maxAttempts = Number(process.env.LEVEL3_MAX_ATTEMPTS ?? 4);
  const maxRepairRounds = Math.max(1, Math.floor(maxAttempts));
  const maxLocalIterations = readPositiveIntegerEnv("LEVEL3_MAX_LOCAL_ITERATIONS", maxRepairRounds + 3, 1);
  const repairCandidateCount = Math.max(1, Number(process.env.LEVEL3_REPAIR_CANDIDATES ?? 1));
  const repairModelCandidates = readModelCandidatesEnv("LEVEL3_REPAIR_LLM_MODELS", "LEVEL3_REPAIR_LLM_MODEL");
  const zeroPlateauStopEnabled = process.env.LEVEL3_STOP_ON_ZERO_PLATEAU !== "0";
  const zeroPlateauMinValidations = readPositiveIntegerEnv("LEVEL3_ZERO_PLATEAU_ATTEMPTS", 2, 1);
  const localSemanticGate = runLocalSemantics && process.env.LEVEL3_LOCAL_SEMANTIC_GATE === "1";
  const minRepairBudgetMs = readPositiveIntegerEnv("LEVEL3_MIN_REPAIR_BUDGET_MS", 45_000, 0);
  let validation: Level3ValidationResponse | undefined;
  let localVerification: Level3LocalVerificationResult | undefined;
  let bestCode = code;
  let bestValidation: Level3ValidationResponse | undefined;
  let bestPassCount = -1;
  let plateauCount = 0;
  const validationHistory: Level3ValidationHistoryEntry[] = [];
  let repairRoundsCompleted = 0;
  let pendingValidatedCode:
    | {
        code: string;
        validation: Level3ValidationResponse;
        localVerification?: Level3LocalVerificationResult;
      }
    | undefined;
  lastValidationPassedNames = new Set<string>();
  let solved = false;

  for (let attempt = 1; attempt <= maxLocalIterations; attempt += 1) {
    const attemptLabel = String(attempt).padStart(2, "0");
    let reusedPendingValidation = false;
    if (pendingValidatedCode?.code === code) {
      validation = pendingValidatedCode.validation;
      localVerification = pendingValidatedCode.localVerification;
      pendingValidatedCode = undefined;
      reusedPendingValidation = true;
      solved = allLevel3ChecksPassed(validation, challenge.checks.length);
      console.log(
        `Level 3 validation ${attempt}: reusing beam-scored ${countLevel3Passes(validation)}/${challenge.checks.length} checks`
      );
    } else {
      localVerification = await verifyLevel3Source(runDir, attemptLabel, challenge, code, {
        generatedVerifierSource,
        skipSemantic: !runLocalSemantics
      });
      await writeJson(path.join(runDir, `local-verify-${attemptLabel}.json`), localVerification);
      if (!localVerification.ok) {
        const passedSemanticChecks = localVerification.semantic?.checks.filter((check) => check.ok).length ?? 0;
        const totalSemanticChecks = localVerification.semantic?.checks.length ?? 0;
        console.warn(
          `Level 3 local verification ${attempt}: ${
            localVerification.compile.ok ? `${passedSemanticChecks}/${totalSemanticChecks} semantic checks` : "compile failed"
          }`
        );
        if (
          !shouldRepairBeforeServerValidation(localVerification, {
            hasGeneratedVerifier: Boolean(generatedVerifierSource),
            localSemanticGate
          })
        ) {
          console.warn("Local semantic verifier failed in advisory mode; trying server validation with current compiled code.");
        } else {
          if (attempt === maxLocalIterations) {
            if (shouldValidateCurrentCodeAfterMissingRepair(localVerification)) {
              console.warn("Max local repair attempts reached; trying server validation with current compiled code.");
            } else {
              break;
            }
          } else {
            const repaired = await solveLevel3WithLlmDetailed(
              challenge,
              { previousCode: code, localVerification, modelCandidates: repairModelCandidates },
              renderedContext
            );
            await writeLevel3LlmTrace(runDir, `local-repair-${attemptLabel}`, repaired);
            if (!repaired.code?.trim()) {
              if (shouldValidateCurrentCodeAfterMissingRepair(localVerification)) {
                console.warn("LLM did not return repair code; trying server validation with current compiled code.");
              } else {
                throw new Error("LLM did not return repair code for Level 3.");
              }
            } else {
              code = repaired.code;
              await fs.writeFile(path.join(runDir, `attempt-${attemptLabel}.${sourceExtension(challenge.language)}`), code);
              continue;
            }
          }
        }
      }

      validation = await client.validateCode(session.sessionId, challenge.id, code);
      await writeJson(path.join(runDir, `validation-${attemptLabel}.json`), validation);

      solved = allLevel3ChecksPassed(validation, challenge.checks.length);
      const passCount = countLevel3Passes(validation);
      validationHistory.push(buildValidationHistoryEntry(validationHistory.length + 1, validation));
      if (passCount > bestPassCount) {
        bestPassCount = passCount;
        bestCode = code;
        bestValidation = validation;
        plateauCount = 0;
      } else {
        plateauCount += 1;
        code = bestCode;
      }
      console.log(
        `Level 3 validation ${attempt}: ${
          validation.compiled === false ? "compile failed" : passCount
        }/${challenge.checks.length} checks`
      );
    }
    if (solved) break;
    if (repairRoundsCompleted >= maxRepairRounds) break;
    if (remainingLevel3SessionMs(session) < minRepairBudgetMs) {
      console.warn(
        `Skipping further Level 3 repair: only ${remainingLevel3SessionMs(session)}ms remain before session expiry.`
      );
      break;
    }
    if (
      zeroPlateauStopEnabled &&
      shouldStopAfterZeroPassPlateau(validationHistory, zeroPlateauMinValidations)
    ) {
      console.warn(
        `Level 3 remained at 0/${challenge.checks.length} for ${zeroPlateauMinValidations} server validation(s); stopping early for escalation or a new draw.`
      );
      break;
    }

    const beam = await generateAndValidateServerRepairBeam(
      client,
      session,
      runDir,
      attemptLabel,
      challenge,
      renderedContext,
      bestCode,
      bestValidation ?? validation,
      localVerification,
      validationHistory,
      repairCandidateCount,
      plateauCount,
      generatedVerifierSource,
      repairModelCandidates,
      runLocalSemantics
    );
    repairRoundsCompleted += 1;

    let bestBeamSubmission: ServerRepairSubmission | undefined;
    for (const submission of beam.submissions) {
      validationHistory.push(buildValidationHistoryEntry(validationHistory.length + 1, submission.validation));
      if (!bestBeamSubmission || submission.passCount > bestBeamSubmission.passCount) {
        bestBeamSubmission = submission;
      }
      if (submission.passCount > bestPassCount) {
        bestPassCount = submission.passCount;
        bestCode = submission.code;
        bestValidation = submission.validation;
        localVerification = submission.localVerification;
        plateauCount = 0;
      }
      if (allLevel3ChecksPassed(submission.validation, challenge.checks.length)) {
        solved = true;
      }
    }

    if (beam.submissions.length === 0) {
      console.warn("No locally compiling server-repair candidate was produced; stopping with the best server-backed code.");
      break;
    }

    if (!bestBeamSubmission || bestBeamSubmission.passCount <= countLevel3Passes(validation)) {
      plateauCount += 1;
    }

    code = bestCode;
    if (bestValidation) {
      pendingValidatedCode = {
        code: bestCode,
        validation: bestValidation,
        localVerification
      };
    }
    await fs.writeFile(path.join(runDir, `attempt-${attemptLabel}.${sourceExtension(challenge.language)}`), code);
    if (solved) break;
  }

  if (!solved && process.env.LEVEL3_FINISH_UNSOLVED !== "1") {
    const completedValidations = validationHistory.length;
    const bestSummary = bestPassCount >= 0 ? ` Best server score: ${bestPassCount}/${challenge.checks.length}.` : "";
    throw new Error(
      `Level 3 did not pass all checks after ${completedValidations} server validation(s).${bestSummary} Artifacts: ${runDir}`
    );
  }

  const timeElapsed = Math.max(0, Date.now() - (session.startedAt ?? startedAt));
  const result = await client.finishSession(session, code, github, timeElapsed);
  const finishedAt = Date.now();

  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level3",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    solverMode,
    sessionStartMode,
    renderedContext: {
      prestartTextLength: renderedContext.prestartText?.length ?? 0,
      renderedChallengeTextLength: renderedContext.renderedChallengeText?.length ?? 0
    },
    generatedVerifier: generatedVerifierSource
      ? {
          enabled: true,
          sourceLength: generatedVerifierSource.length
        }
      : {
          enabled: false
        },
    localVerificationMode: runLocalSemantics ? "semantic" : "compile",
    challenge: {
      id: challenge.id,
      taskName: challenge.taskName,
      language: challenge.language,
      checks: challenge.checks
    },
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    validation,
    localVerification,
    bestPassCount,
    validationHistory,
    repairRoundsCompleted,
    maxRepairRounds,
    maxLocalIterations,
    minRepairBudgetMs,
    solvedBeforeFinish: solved
  });

  console.log(`Level 3 attempt artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, unlocked=${result.progress?.unlockedLevel}`
  );
}

async function runLevel3SpeedDemon(runDir: string, github: string, startedAt: number): Promise<void> {
  const allowUnverified = process.env.LEVEL3_SPEED_DEMON_ALLOW_UNVERIFIED === "1";
  const client = await createLevel3Client();
  const preview = resolveLevel3PreviewOverride(process.env) ?? (await client.preview());
  const session = await client.startSession(preview.previewToken);

  const submitStart = Date.now();
  const challenge = session.problems[0];
  if (!challenge) {
    throw new Error("Level 3 session did not include a challenge payload.");
  }
  const code = await loadLevel3CandidateCode(challenge.taskName, challenge.language, { allowUnverified });
  if (!code?.trim()) {
    throw new Error(
      `Level 3 speed-demon: no${allowUnverified ? "" : " verified"} candidate registered for ${challenge.taskName} [${challenge.language}].`
    );
  }
  const timeElapsed = Math.max(0, submitStart - (session.startedAt ?? submitStart));
  const result = await client.finishSession(session, code, github, timeElapsed);
  const finishedAt = Date.now();

  await writeJson(path.join(runDir, "preview.json"), preview);
  await writeJson(path.join(runDir, "session.json"), session);
  await fs.writeFile(path.join(runDir, `attempt-00.${sourceExtension(challenge.language)}`), code);
  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, "metadata.json"), {
    command: "level3",
    mode: "speed-demon",
    outputRoot: OUTPUT_ROOT,
    runDir,
    github,
    startedAt,
    finishedAt,
    elapsedMs: finishedAt - startedAt,
    submitToFinishMs: finishedAt - submitStart,
    serverTimeElapsedMs: timeElapsed,
    challenge: {
      id: challenge.id,
      taskName: challenge.taskName,
      language: challenge.language
    },
    allowUnverifiedCandidate: allowUnverified
  });

  console.log(`Level 3 (speed-demon) artifacts: ${runDir}`);
  console.log(
    `Result: ${result.attempt.solved}/${result.attempt.total} solved, status=${result.attempt.status}, score=${result.attempt.score}, serverElapsedMs=${timeElapsed}`
  );
}

interface Level3ValidationHistoryEntry {
  attempt: number;
  passed: number;
  failed: string[];
  gained: string[];
  lost: string[];
}

interface ServerRepairSubmission {
  label: string;
  code: string;
  localVerification: Level3LocalVerificationResult;
  validation: Level3ValidationResponse;
  passCount: number;
}

interface ServerRepairBeamResult {
  submissions: ServerRepairSubmission[];
}

async function generateAndValidateServerRepairBeam(
  client: Level3Client,
  session: Level3Session,
  runDir: string,
  attemptLabel: string,
  challenge: Level3Challenge,
  renderedContext: Level3RenderedContext,
  bestCode: string,
  bestValidation: Level3ValidationResponse,
  localVerification: Level3LocalVerificationResult | undefined,
  validationHistory: Level3ValidationHistoryEntry[],
  candidateCount: number,
  plateauCount: number,
  generatedVerifierSource: string | undefined,
  repairModelCandidates: string[] | undefined,
  runLocalSemantics: boolean
): Promise<ServerRepairBeamResult> {
  const strategies = buildLevel3FamilyRepairStrategies(challenge.taskName, bestValidation, {
    candidateCount,
    plateau: plateauCount > 0
  });
  const repairs = await Promise.all(
    strategies.map((repairStrategy) =>
      solveLevel3WithLlmDetailed(
        challenge,
        buildLevel3RepairFeedback(bestCode, bestValidation, localVerification, {
          validationHistory,
          repairStrategy,
          modelCandidates: repairModelCandidates
        }),
        renderedContext
      )
    )
  );

  const submissions: ServerRepairSubmission[] = [];
  const compileRepairInputs: Array<{
    index: number;
    label: string;
    code: string;
    verification: Level3LocalVerificationResult;
  }> = [];

  for (let index = 0; index < repairs.length; index += 1) {
    const candidateLabel =
      repairs.length === 1 ? `server-repair-${attemptLabel}` : `server-repair-${attemptLabel}-${index + 1}`;
    const repaired = repairs[index];
    if (!repaired) continue;
    await writeLevel3LlmTrace(runDir, candidateLabel, repaired);
    if (!repaired?.code?.trim()) continue;

    const codePath = path.join(
      runDir,
      `attempt-${attemptLabel}-candidate-${index + 1}.${sourceExtension(challenge.language)}`
    );
    await fs.writeFile(codePath, repaired.code);
    const candidateVerification = await verifyLevel3Source(
      runDir,
      `${attemptLabel}-candidate-${index + 1}`,
      challenge,
      repaired.code,
      { generatedVerifierSource, skipSemantic: !runLocalSemantics }
    );
    await writeJson(path.join(runDir, `local-verify-${attemptLabel}-candidate-${index + 1}.json`), candidateVerification);
    if (candidateVerification.compile.ok) {
      const submission = await tryValidateRepairCandidate(
        client,
        session,
        challenge,
        runDir,
        candidateLabel,
        repaired.code,
        candidateVerification
      );
      if (submission) submissions.push(submission);
      continue;
    }
    compileRepairInputs.push({
      index,
      label: candidateLabel,
      code: repaired.code,
      verification: candidateVerification
    });
  }

  const compileRepairs = await Promise.all(
    compileRepairInputs.map((input) =>
      solveLevel3WithLlmDetailed(
        challenge,
        buildLevel3CompileRepairFeedback(
          input.code,
          bestValidation,
          input.verification,
          validationHistory,
          repairModelCandidates
        ),
        renderedContext
      )
    )
  );

  for (let repairIndex = 0; repairIndex < compileRepairs.length; repairIndex += 1) {
    const input = compileRepairInputs[repairIndex];
    const repaired = compileRepairs[repairIndex];
    if (!input || !repaired) continue;

    const candidateNumber = input.index + 1;
    const candidateLabel = `${input.label}-compile-fix`;
    await writeLevel3LlmTrace(runDir, candidateLabel, repaired);
    if (!repaired.code?.trim()) continue;

    const codePath = path.join(
      runDir,
      `attempt-${attemptLabel}-candidate-${candidateNumber}-compile-fix.${sourceExtension(challenge.language)}`
    );
    await fs.writeFile(codePath, repaired.code);
    const candidateVerification = await verifyLevel3Source(
      runDir,
      `${attemptLabel}-candidate-${candidateNumber}-compile-fix`,
      challenge,
      repaired.code,
      { generatedVerifierSource, skipSemantic: !runLocalSemantics }
    );
    await writeJson(
      path.join(runDir, `local-verify-${attemptLabel}-candidate-${candidateNumber}-compile-fix.json`),
      candidateVerification
    );
    if (candidateVerification.compile.ok) {
      const submission = await tryValidateRepairCandidate(
        client,
        session,
        challenge,
        runDir,
        candidateLabel,
        repaired.code,
        candidateVerification
      );
      if (submission) submissions.push(submission);
    }
  }

  return { submissions };
}

async function tryValidateRepairCandidate(
  client: Level3Client,
  session: Level3Session,
  challenge: Level3Challenge,
  runDir: string,
  label: string,
  code: string,
  localVerification: Level3LocalVerificationResult
): Promise<ServerRepairSubmission | undefined> {
  const minValidateBudgetMs = readPositiveIntegerEnv("LEVEL3_MIN_VALIDATE_BUDGET_MS", 8_000, 0);
  if (remainingLevel3SessionMs(session) < minValidateBudgetMs) {
    console.warn(
      `${label}: skipping server validation; only ${remainingLevel3SessionMs(session)}ms remain before session expiry.`
    );
    return undefined;
  }
  try {
    return await validateRepairCandidate(client, session, challenge, runDir, label, code, localVerification);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJson(path.join(runDir, `validation-${label}-error.json`), {
      label,
      error: message,
      remainingMs: remainingLevel3SessionMs(session)
    });
    console.warn(`${label}: server validation failed: ${message}`);
    return undefined;
  }
}

async function validateRepairCandidate(
  client: Level3Client,
  session: Level3Session,
  challenge: Level3Challenge,
  runDir: string,
  label: string,
  code: string,
  localVerification: Level3LocalVerificationResult
): Promise<ServerRepairSubmission> {
  const validation = await client.validateCode(session.sessionId, challenge.id, code);
  await writeJson(path.join(runDir, `validation-${label}.json`), validation);
  const passCount = countLevel3Passes(validation);
  console.log(
    `${label}: server ${validation.compiled === false ? "compile failed" : `${passCount}/${challenge.checks.length}`}`
  );
  return {
    label,
    code,
    localVerification,
    validation,
    passCount
  };
}

function remainingLevel3SessionMs(session: Pick<Level3Session, "expiresAt">): number {
  return Math.max(0, session.expiresAt - Date.now());
}

function buildValidationHistoryEntry(attempt: number, validation: Level3ValidationResponse): Level3ValidationHistoryEntry {
  const passedNames = new Set(
    (validation.results ?? [])
      .filter((result) => result.correct)
      .map((result) => String(result.name ?? result.problemId ?? "unknown check"))
  );
  const failed = (validation.results ?? [])
    .filter((result) => !result.correct)
    .map((result) => String(result.name ?? result.problemId ?? "unknown check"));
  const previous = lastValidationPassedNames;
  lastValidationPassedNames = passedNames;
  return {
    attempt,
    passed: passedNames.size,
    failed,
    gained: [...passedNames].filter((name) => !previous.has(name)),
    lost: [...previous].filter((name) => !passedNames.has(name))
  };
}

let lastValidationPassedNames = new Set<string>();

async function maybeGenerateLocalVerifier(runDir: string, challenge: Level3Challenge): Promise<string | undefined> {
  if (process.env.LEVEL3_DYNAMIC_LOCAL_VERIFY !== "1") return undefined;

  console.log("Generating Level 3 local verifier harness...");
  const verifier = await generateLevel3VerifierWithLlm(challenge);
  if (!verifier?.trim()) {
    console.warn("Level 3 verifier generation returned no harness; continuing with compile-only local checks.");
    return undefined;
  }
  const filePath = path.join(runDir, `generated-verifier.${sourceExtension("C")}`);
  await fs.writeFile(filePath, verifier);
  return verifier;
}

async function loadInitialCode(
  runDir: string,
  challenge: Level3Challenge,
  renderedContext: Level3RenderedContext
): Promise<string> {
  const codeFile = process.env.LEVEL3_CODE_FILE;
  if (codeFile) return fs.readFile(path.resolve(codeFile), "utf8");

  const solverMode = parseLevel3SolverMode(process.env.LEVEL3_SOLVER_MODE);
  if (shouldUseLevel3RegisteredCandidate(process.env)) {
    const candidate = await loadLevel3CandidateCode(challenge.taskName, challenge.language);
    if (candidate?.trim()) {
      console.log(`Using registered Level 3 candidate for ${challenge.taskName} [${challenge.language}].`);
      return candidate;
    }
    if (solverMode === "candidate" && process.env.LEVEL3_ALLOW_UNVERIFIED_CANDIDATES === "1") {
      const unverifiedCandidate = await loadLevel3CandidateCode(challenge.taskName, challenge.language, {
        allowUnverified: true
      });
      if (unverifiedCandidate?.trim()) {
        console.log(`Using unverified Level 3 candidate for ${challenge.taskName} [${challenge.language}].`);
        return unverifiedCandidate;
      }
    }
    if (solverMode === "candidate") {
      throw new Error(`No candidate code registered for ${challenge.taskName} [${challenge.language}].`);
    }
  }

  if (
    (solverMode === "hybrid" || solverMode === "specialist") &&
    process.env.LEVEL3_DISABLE_TEMPLATES !== "1" &&
    process.env.LEVEL3_ENABLE_EXPERIMENTAL_TEMPLATES === "1"
  ) {
    const template = renderLevel3FamilyTemplate(challenge.taskName, challenge.language);
    if (template?.trim()) {
      console.log(`Using Level 3 family template for ${challenge.taskName} [${challenge.language}].`);
      return template;
    }
  }

  const allowUnverifiedSpecialist =
    solverMode === "specialist" || process.env.LEVEL3_ALLOW_UNVERIFIED_SPECIALISTS === "1";
  if (allowUnverifiedSpecialist) {
    const specialist = solveTraitExpressionTask(challenge.taskName, challenge.language);
    if (specialist) {
      console.log(`Using Level 3 specialist for ${challenge.taskName} [${challenge.language}].`);
      return specialist;
    }
  }

  console.log(`Using live Level 3 synthesis for ${challenge.taskName} [${challenge.language}].`);
  const result = await solveLevel3WithLlmDetailed(challenge, {}, renderedContext);
  await writeLevel3LlmTrace(runDir, "initial", result);
  if (result.code?.trim()) return result.code;
  if (solverMode === "dynamic") {
    throw new Error("Live Level 3 synthesis returned no code; refusing to submit starter code in dynamic mode.");
  }

  if (allowUnverifiedSpecialist) {
    const specialist = solveTraitExpressionTask(challenge.taskName, challenge.language);
    if (specialist) return specialist;
  }

  if (challenge.starterCode?.trim()) return challenge.starterCode;
  throw new Error("No LEVEL3_CODE_FILE, no LLM code, and no starter code were available.");
}

async function writeLevel3LlmTrace(runDir: string, label: string, result: Level3LlmSolveResult): Promise<void> {
  await writeJson(path.join(runDir, `llm-trace-${label}.json`), {
    contract: result.contract,
    contractLength: result.contract?.length ?? 0,
    codeLength: result.code?.length ?? 0,
    calls: result.calls.map((call) => ({
      stage: call.stage,
      model: call.model,
      rawContent: call.rawContent,
      rawContentLength: call.rawContent?.length ?? 0,
      extractedContract: call.extractedContract,
      extractedCodeLength: call.extractedCodeLength,
      request: call.request
    }))
  });
}

type Level3SessionStartMode = "api" | "ui";

function parseSessionStartMode(value: string): Level3SessionStartMode {
  if (value === "api" || value === "ui") return value;
  throw new Error(`Invalid LEVEL3_SESSION_START_MODE '${value}'. Expected api or ui.`);
}

function printHelp(): void {
  console.log(`Usage:
  npm run level3:preview   Safely fetch current Level 3 prereq preview. Does not start timer.
  npm run level3 -- catalog Catalog random Level 3 preview assignments. Does not start timer.
  npm run level3           Start Level 3, ask LLM for code, validate, finish.

Environment:
	  CHEETCODE_GITHUB          Required authenticated GitHub handle
	  LEVEL3_CODE_FILE          Submit/validate code from this file instead of asking the LLM
	  LEVEL3_PREVIEW_TOKEN      Reuse a safe-preview token instead of drawing a new random challenge
	  LEVEL3_SOLVER_MODE        dynamic, hybrid, specialist, or candidate. Default: ${DEFAULT_LEVEL3_SOLVER_MODE}
	  LEVEL3_SESSION_START_MODE api or ui. Default: api
	  LEVEL3_ALLOW_UNVERIFIED_CANDIDATES=1  Allow compile-only candidate artifacts in hybrid/candidate mode
	  LEVEL3_ALLOW_UNVERIFIED_SPECIALISTS=1 Allow non-server-proven specialist code in hybrid mode
	  LEVEL3_ENABLE_EXPERIMENTAL_TEMPLATES=1 Use local-only family templates that are not server-proven yet
	  LEVEL3_SKELETON_HOLES=1 Use locked skeleton + per-hole workers for supported fresh families
	  LEVEL3_LLM_PROVIDER       openai-compatible, cerebras, openai, anthropic, vertex, or codex-cli
	  LEVEL3_LLM_MODEL          Per-level model override
	  SMART_LLM_MODEL           Default strong model for Level 2/3
		  LEVEL3_MAX_ATTEMPTS       Server repair rounds after validation. Default: 4
		  LEVEL3_MAX_LOCAL_ITERATIONS Local compile/repair loop cap. Default: LEVEL3_MAX_ATTEMPTS+3
		  LEVEL3_REPAIR_CANDIDATES  Parallel repair candidates after each server validation. Default: 1
		  LEVEL3_REPAIR_LLM_MODEL    Optional model override for local/server repair calls
		  LEVEL3_REPAIR_LLM_MODELS   Optional comma-separated repair model override list
		  LEVEL3_STOP_ON_ZERO_PLATEAU=0 Disable early stop after repeated 0-check server validations
		  LEVEL3_ZERO_PLATEAU_ATTEMPTS Default: 2
		  LEVEL3_LOCAL_VERIFY_MODE=semantic Opt in to local semantic harnesses. Default: compile-only/server-judged
		  LEVEL3_LOCAL_SEMANTIC_GATE=1 Require opted-in local semantic verifier to pass before server validation
		  LEVEL3_LLM_MAX_TOKENS     Default: 8000
		  LEVEL3_TWO_STAGE_SYNTHESIS=0 Disable contract-first initial synthesis
		  LEVEL3_CONTRACT_LLM_MAX_TOKENS Default: 6000
		  LEVEL3_FUNCTION_DECOMPOSITION=1 Use locked data-model + per-function workers for fresh solves
		  LEVEL3_DECOMP_WORKER_LLM_MODEL Default worker model is gpt-oss-120b
		  LEVEL3_MAX_BINARY_BYTES   Default: 134217728
		  LEVEL3_DYNAMIC_LOCAL_VERIFY=1 Generate and run a local challenge-specific verifier harness before server validate
		  LEVEL3_FINISH_UNSOLVED=1  Finish even when validation did not pass all checks
  LEVEL3_CATALOG_SAMPLES    Default for catalog: 12
  LEVEL3_SPEED_DEMON=1       Sub-1s submit. Looks up the registered verified candidate for the drawn (taskName, language), skips local-verify, server-validate, and repair. Fails loud if no verified candidate is registered.
  LEVEL3_SPEED_DEMON_ALLOW_UNVERIFIED=1  Allow unverified candidates in speed-demon mode (riskier; only correctness-verified candidates fire SPEED DEMON).
`);
}

function sourceExtension(language: string): string {
  if (language === "Rust") return "rs";
  if (language === "C") return "c";
  if (language === "C++") return "cpp";
  return "txt";
}

function readPositiveIntegerEnv(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function readModelCandidatesEnv(listName: string, singleName: string): string[] | undefined {
  const raw = process.env[listName] ?? process.env[singleName];
  const values = raw
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values && values.length > 0 ? [...new Set(values)] : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

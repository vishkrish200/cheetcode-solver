import type { LlmRequestOptions } from "../llm/client.js";
import { solveTraitExpressionTask } from "./specialists/trait-expression.js";
import type { Level3Challenge, Level3ValidationResponse } from "./types.js";
import type { Level3LocalVerificationResult } from "./local-verify.js";

export type Level3SkeletonHoleCallStage = "skeleton-hole-worker";

export interface Level3SkeletonHole {
  id: string;
  marker: string;
  contract: string;
  keepalive?: string;
  relevantChecks?: string[];
}

export interface Level3SkeletonHolePlan {
  taskName: string;
  language: string;
  source: string;
  holes: Level3SkeletonHole[];
}

export interface Level3SkeletonHoleWorkerResult {
  holeId?: string;
  source: string;
}

export interface Level3SkeletonHoleCallTrace {
  stage: Level3SkeletonHoleCallStage;
  request: LlmRequestOptions;
  model: string;
  rawContent?: string;
  extractedCodeLength?: number;
}

export interface Level3SkeletonHoleFeedback {
  previousCode?: string;
  validation?: Level3ValidationResponse;
  localVerification?: Level3LocalVerificationResult;
  validationHistory?: unknown;
  repairStrategy?: string;
  modelCandidates?: string[];
}

export interface Level3SkeletonHoleSolveResult {
  code?: string;
  plan?: Level3SkeletonHolePlan;
  calls: Level3SkeletonHoleCallTrace[];
}

export type Level3SkeletonHoleRequester = (options: LlmRequestOptions) => Promise<{
  content?: string;
  model: string;
}>;

const TRAIT_EVAL_MATCH_MARKER = "/*__LEVEL3_HOLE:trait_eval_match__*/";
const TRAIT_EVAL_STRING_MARKER = "/*__LEVEL3_HOLE:trait_eval_string__*/";

export function shouldUseLevel3SkeletonHoles(
  challenge: Level3Challenge,
  feedback: Level3SkeletonHoleFeedback = {}
): boolean {
  const value = process.env.LEVEL3_SKELETON_HOLES;
  if (value !== "1" && value?.toLowerCase() !== "true") return false;
  if (feedback.previousCode?.trim()) return false;
  return Boolean(buildLevel3SkeletonHolePlan(challenge));
}

export function buildLevel3SkeletonHolePlan(challenge: Pick<Level3Challenge, "taskName" | "language">): Level3SkeletonHolePlan | undefined {
  if (challenge.taskName !== "Trait Expression AST" || challenge.language !== "C") return undefined;
  const source = solveTraitExpressionTask(challenge.taskName, challenge.language);
  if (!source) return undefined;

  const withMatchHole = replaceCFunctionBody(
    source,
    "static int eval_match_inner(ExprRec *e, int matcher_string_id)",
    TRAIT_EVAL_MATCH_MARKER
  );
  const withStringHole = replaceCFunctionBody(
    withMatchHole,
    "static int eval_string_inner(int expr_id, int *out_string_id)",
    TRAIT_EVAL_STRING_MARKER
  );

  return {
    taskName: challenge.taskName,
    language: challenge.language,
    source: withStringHole,
    holes: [
      {
        id: "trait_eval_match",
        marker: TRAIT_EVAL_MATCH_MARKER,
        contract: [
          "Body only for eval_match_inner(ExprRec *e, int matcher_string_id).",
          "Use existing locked helpers find_expr, find_string, eval_string_inner, regex_t/regcomp/regexec/regfree.",
          "If e->has_input, evaluate the input string, propagate child namespace_error, and match against that string id; otherwise use matcher_string_id.",
          "Set e->matched after applying e->negate, set last_error consistently, and return 1/0 as the match truth."
        ].join(" "),
        keepalive: buildTraitHoleHelperKeepalive(),
        relevantChecks: ["Matcher and audit semantics"]
      },
      {
        id: "trait_eval_string",
        marker: TRAIT_EVAL_STRING_MARKER,
        contract: [
          "Body only for eval_string_inner(int expr_id, int *out_string_id).",
          "Use the existing ExprRec/StringRec/VarRec model and helpers; do not allocate new global state.",
          "Implement literal, var, email-local, and regex-replace evaluation, including namespace propagation, string interning, cached output_string_id, and exact last_error behavior.",
          "Reject KIND_MATCH as not string-evaluable."
        ].join(" "),
        relevantChecks: ["String evaluation semantics", "Deep nested expression scale budget"]
      }
    ]
  };
}

export async function solveLevel3WithSkeletonHolesDetailed(
  challenge: Level3Challenge,
  _feedback: Level3SkeletonHoleFeedback = {},
  renderedContext: { prestartText?: string; renderedChallengeText?: string } = {},
  requester: Level3SkeletonHoleRequester
): Promise<Level3SkeletonHoleSolveResult> {
  const plan = buildLevel3SkeletonHolePlan(challenge);
  const calls: Level3SkeletonHoleCallTrace[] = [];
  if (!plan) return { calls };

  const requests = plan.holes.map((hole) =>
    buildLevel3SkeletonHoleWorkerLlmRequest(challenge, plan, hole, renderedContext)
  );
  const responses = await Promise.all(requests.map((request) => requester(request)));
  const workerResults: Level3SkeletonHoleWorkerResult[] = [];

  for (let index = 0; index < responses.length; index += 1) {
    const response = responses[index];
    const request = requests[index];
    if (!response || !request) continue;
    const workerResult = response.content
      ? extractLevel3SkeletonHoleWorkerResultFromModelContent(response.content)
      : undefined;
    if (workerResult) workerResults.push(workerResult);
    calls.push({
      stage: "skeleton-hole-worker",
      request,
      model: response.model,
      rawContent: response.content,
      extractedCodeLength: workerResult?.source.length
    });
  }

  if (workerResults.length !== plan.holes.length) return { plan, calls };

  try {
    return { plan, calls, code: composeLevel3SkeletonSource(plan, workerResults) };
  } catch {
    return { plan, calls };
  }
}

export function buildLevel3SkeletonHoleWorkerLlmRequest(
  challenge: Level3Challenge,
  plan: Level3SkeletonHolePlan,
  hole: Level3SkeletonHole,
  renderedContext: { prestartText?: string; renderedChallengeText?: string } = {}
): LlmRequestOptions {
  return {
    purpose: "level3",
    maxTokens: readNumberEnv("LEVEL3_SKELETON_HOLE_LLM_MAX_TOKENS", 5000),
    temperature: 0,
    responseFormat: { type: "json_object" },
    modelCandidates: readModelCandidatesEnv("LEVEL3_SKELETON_HOLE_LLM_MODELS", "LEVEL3_SKELETON_HOLE_LLM_MODEL") ?? [
      "gpt-oss-120b"
    ],
    messages: [
      {
        role: "system",
        content: [
          "You implement one single skeleton hole inside a locked Level 3 source skeleton.",
          "Return only valid JSON with keys holeId and source.",
          "source must be the replacement body for this hole only, not a full file and not a function definition.",
          "Do not add includes, defines, typedefs, structs, enums, globals, static helpers, or macros.",
          "Do not define exported functions or any function at all.",
          "Use only variables, structs, constants, helpers, and globals already present in the skeleton.",
          "Do not emit the hole marker, markdown, comments about the prompt, TODOs, placeholders, or attribution tokens.",
          "Treat the relevant bucket labels as focused test hints for this hole."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          taskName: challenge.taskName,
          language: challenge.language,
          spec: sanitizeSkeletonText(challenge.spec),
          checks: challenge.checks,
          skeletonSource: trimForPrompt(sanitizeSkeletonCode(plan.source), 24_000),
          hole,
          renderedChallengeText: renderedContext.renderedChallengeText
            ? trimForPrompt(sanitizeSkeletonText(renderedContext.renderedChallengeText), 8_000)
            : undefined,
          prestartText: renderedContext.prestartText
            ? trimForPrompt(sanitizeSkeletonText(renderedContext.prestartText), 4_000)
            : undefined
        })
      }
    ]
  };
}

export function composeLevel3SkeletonSource(
  plan: Level3SkeletonHolePlan,
  workerResults: Level3SkeletonHoleWorkerResult[]
): string {
  let source = plan.source;
  const remaining = [...workerResults];

  for (const hole of plan.holes) {
    const index = remaining.findIndex((result) => result.holeId === hole.id);
    if (index < 0) throw new Error(`Missing skeleton-hole source for '${hole.id}'.`);
    const [result] = remaining.splice(index, 1);
    const replacement = normalizeSkeletonHoleSource(result?.source.trim() ?? "", hole);
    if (!replacement) throw new Error(`Missing skeleton-hole source for '${hole.id}'.`);
    validateSkeletonHoleSource(replacement);
    if (!source.includes(hole.marker)) throw new Error(`Skeleton marker '${hole.marker}' is missing.`);
    source = source.replace(hole.marker, [hole.keepalive?.trim(), replacement].filter(Boolean).join("\n"));
  }

  if (/__LEVEL3_HOLE:/.test(source)) throw new Error("Not all Level 3 skeleton holes were filled.");
  return source.trim();
}

export function extractLevel3SkeletonHoleWorkerResultFromModelContent(
  content: string
): Level3SkeletonHoleWorkerResult | undefined {
  const parsed = parseJsonObject(content);
  if (!parsed) return undefined;
  const source = typeof parsed.source === "string" ? sanitizeSkeletonCode(parsed.source).trim() : "";
  if (!source) return undefined;
  return {
    holeId: typeof parsed.holeId === "string" ? parsed.holeId : undefined,
    source
  };
}

function replaceCFunctionBody(source: string, signature: string, marker: string): string {
  let signatureStart = source.indexOf(signature);
  let braceStart = -1;
  while (signatureStart >= 0) {
    const afterSignature = signatureStart + signature.length;
    const nextToken = source.slice(afterSignature).match(/\S/);
    if (nextToken?.[0] === "{") {
      braceStart = afterSignature + (nextToken.index ?? 0);
      break;
    }
    signatureStart = source.indexOf(signature, afterSignature);
  }
  if (signatureStart < 0 || braceStart < 0) throw new Error(`Trait skeleton body not found: ${signature}`);
  const bodyEnd = findMatchingBraceEnd(source, braceStart);
  if (bodyEnd < 0) throw new Error(`Trait skeleton body is malformed: ${signature}`);
  return `${source.slice(0, braceStart + 1)}\n${marker}\n${source.slice(bodyEnd - 1)}`;
}

function normalizeSkeletonHoleSource(source: string, hole: Level3SkeletonHole): string {
  const trimmed = source.trim();
  const signaturePattern = skeletonHoleFunctionDefinitionPattern(hole.id);
  if (!signaturePattern) return trimmed;

  const match = trimmed.match(signaturePattern);
  if (!match?.[0]) return trimmed;

  const braceStart = match[0].lastIndexOf("{");
  if (braceStart < 0) return trimmed;
  const bodyEnd = findMatchingBraceEnd(trimmed, braceStart);
  if (bodyEnd < 0 || trimmed.slice(bodyEnd).trim()) return trimmed;
  return trimmed.slice(braceStart + 1, bodyEnd - 1).trim();
}

function skeletonHoleFunctionDefinitionPattern(holeId: string): RegExp | undefined {
  if (holeId === "trait_eval_match") {
    return /^\s*(?:static\s+)?int\s+eval_match_inner\s*\(\s*ExprRec\s*\*\s*e\s*,\s*int\s+matcher_string_id\s*\)\s*\{/;
  }
  if (holeId === "trait_eval_string") {
    return /^\s*(?:static\s+)?int\s+eval_string_inner\s*\(\s*int\s+expr_id\s*,\s*int\s*\*\s*out_string_id\s*\)\s*\{/;
  }
  return undefined;
}

function buildTraitHoleHelperKeepalive(): string {
  return [
    "if (0) {",
    "  (void)valid_namespace(0);",
    "  (void)intern_string_value(\"\");",
    "  {",
    "    char *__level3_keepalive = NULL;",
    "    (void)replace_all_regex(\"\", \"\", \"\", &__level3_keepalive);",
    "    free(__level3_keepalive);",
    "  }",
    "}"
  ].join("\n");
}

function validateSkeletonHoleSource(source: string): void {
  const forbidden = [
    /^\s*#\s*(?:include|define|ifdef|ifndef|endif)\b/m,
    /\b__attribute__\s*\(/,
    /\bextern\s+"?C"?\b/,
    /^\s*(?:typedef|struct|enum)\b/m,
    /^\s*(?:static\s+)?(?:int|void|char|long|short|ExprRec|StringRec|VarRec|regex_t)\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^;]*\)\s*\{/m,
    /__LEVEL3_HOLE:/
  ];

  if (forbidden.some((pattern) => pattern.test(source))) {
    throw new Error("forbidden skeleton-hole source: workers may only return the declared hole body");
  }
}

function findMatchingBraceEnd(source: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let inChar = false;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const ch = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' && !inChar) {
      inString = !inString;
      continue;
    }
    if (ch === "'" && !inString) {
      inChar = !inChar;
      continue;
    }
    if (inString || inChar) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  for (const candidate of jsonCandidates(content)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function jsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  return candidates;
}

function sanitizeSkeletonText(text: string): string {
  return text
    .replace(/\[SYSTEM\][^\n]*/gi, "")
    .replace(/lm_[A-Za-z0-9_]+/g, "[removed-token]")
    .trim();
}

function sanitizeSkeletonCode(code: string): string {
  return code.replace(/lm_[A-Za-z0-9_]+/g, "").trim();
}

function trimForPrompt(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[truncated ${text.length - maxLength} chars]`;
}

function readModelCandidatesEnv(listName: string, singleName: string): string[] | undefined {
  const raw = process.env[listName] ?? process.env[singleName];
  const values = raw
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values && values.length > 0 ? [...new Set(values)] : undefined;
}

function readNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

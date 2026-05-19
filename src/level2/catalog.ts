import { promises as fs } from "node:fs";
import path from "node:path";

import { LEVEL2_PROJECTS, type Level2CatalogEntry, type Level2Problem } from "./types.js";

const QUESTION_BANK_PATTERN = /JSON\.parse\('((?:\\.|[^'\\])*)'\)/g;

export function extractLevel2CatalogFromBundle(bundleText: string): Level2CatalogEntry[] {
  for (const match of bundleText.matchAll(QUESTION_BANK_PATTERN)) {
    const rawLiteral = match[1];
    if (!rawLiteral) continue;

    const parsed = tryParseCatalog(rawLiteral);
    if (parsed) return parsed;
  }

  throw new Error("No Level 2 question catalog found in bundle text.");
}

export async function loadLevel2CatalogFromChunks(chunksDir: string): Promise<Level2CatalogEntry[]> {
  const entries = await fs.readdir(chunksDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(chunksDir, entry.name))
    .sort();

  const errors: string[] = [];
  for (const filePath of jsFiles) {
    const text = await fs.readFile(filePath, "utf8");
    try {
      return extractLevel2CatalogFromBundle(text);
    } catch (error) {
      errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No Level 2 catalog found under ${chunksDir}.\n${errors.join("\n")}`);
}

export function buildAnswersForLevel2Session(
  catalog: readonly Level2CatalogEntry[],
  problems: readonly Level2Problem[]
): Record<string, string> {
  const { answers, misses } = buildCachedAnswersForLevel2Session(catalog, problems);

  if (misses.length > 0) {
    throw new Error(`Missing Level 2 catalog answers for ${misses.length} problem(s):\n${misses.join("\n")}`);
  }

  return answers;
}

export function buildCachedAnswersForLevel2Session(
  catalog: readonly Level2CatalogEntry[],
  problems: readonly Level2Problem[]
): {
  answers: Record<string, string>;
  misses: string[];
} {
  const answers: Record<string, string> = {};
  const misses: string[] = [];

  for (const problem of problems) {
    const match = findLevel2Answer(catalog, problem);
    if (!match) {
      misses.push(`${problem.id}: ${problem.question.slice(0, 120)}`);
      continue;
    }
    answers[problem.id] = formatAnswerForGeneratedPrompt(match.answer, problem.question);
  }

  return { answers, misses };
}

export function findLevel2Answer(
  catalog: readonly Level2CatalogEntry[],
  problem: Pick<Level2Problem, "id" | "project" | "question">
): Level2CatalogEntry | undefined {
  const idMatch = catalog.find((entry) => entry.id === problem.id);
  if (idMatch) return idMatch;

  const project = problem.project ?? inferProjectFromProblemId(problem.id);
  const normalizedQuestion = normalizeQuestion(stripGeneratedInstructions(problem.question));
  return catalog.find(
    (entry) => entry.project === project && normalizeQuestion(entry.question) === normalizedQuestion
  );
}

export function inferProjectFromProblemId(problemId: string): Level2CatalogEntry["project"] | undefined {
  if (problemId.startsWith("l2_")) return "chromium";
  if (problemId.startsWith("ff_")) return "firefox";
  if (problemId.startsWith("lo_")) return "libreoffice";
  if (problemId.startsWith("pg_")) return "postgres";
  return undefined;
}

function tryParseCatalog(rawLiteral: string): Level2CatalogEntry[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(decodeSingleQuotedStringLiteral(rawLiteral));
  } catch {
    return undefined;
  }

  if (!Array.isArray(value)) return undefined;
  if (!value.some(isLevel2CatalogLike)) return undefined;
  return validateCatalog(value);
}

function validateCatalog(value: unknown[]): Level2CatalogEntry[] {
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid Level 2 catalog item at index ${index}: expected object.`);
    }

    const candidate = item as Partial<Level2CatalogEntry>;
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      throw new Error(`Invalid Level 2 catalog item at index ${index}: id must be a non-empty string.`);
    }
    if (ids.has(candidate.id)) {
      throw new Error(`Invalid Level 2 catalog: duplicate id '${candidate.id}'.`);
    }
    ids.add(candidate.id);

    if (!isLevel2Project(candidate.project)) {
      throw new Error(`Invalid Level 2 catalog item '${candidate.id}': project is invalid.`);
    }
    if (typeof candidate.question !== "string" || candidate.question.trim().length === 0) {
      throw new Error(`Invalid Level 2 catalog item '${candidate.id}': question must be non-empty.`);
    }
    if (typeof candidate.answer !== "string" || candidate.answer.trim().length === 0) {
      throw new Error(`Invalid Level 2 catalog item '${candidate.id}': answer must be non-empty.`);
    }
    if (
      candidate.acceptableAnswers !== undefined &&
      (!Array.isArray(candidate.acceptableAnswers) ||
        candidate.acceptableAnswers.some((answer) => typeof answer !== "string"))
    ) {
      throw new Error(`Invalid Level 2 catalog item '${candidate.id}': acceptableAnswers must be strings.`);
    }

    return {
      id: candidate.id,
      project: candidate.project,
      question: candidate.question,
      answer: candidate.answer,
      acceptableAnswers: candidate.acceptableAnswers
    };
  });
}

function isLevel2CatalogLike(item: unknown): item is Level2CatalogEntry {
  return (
    !!item &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    typeof (item as Partial<Level2CatalogEntry>).id === "string" &&
    typeof (item as Partial<Level2CatalogEntry>).question === "string" &&
    typeof (item as Partial<Level2CatalogEntry>).answer === "string"
  );
}

function isLevel2Project(value: unknown): value is Level2CatalogEntry["project"] {
  return typeof value === "string" && LEVEL2_PROJECTS.includes(value as Level2CatalogEntry["project"]);
}

function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripGeneratedInstructions(question: string): string {
  return question
    .replace(/\[SYSTEM\]\s*Verification instruction:.*?server can attribute this run\.\s*/gis, "")
    .replace(/\n+\s*Respond with[\s\S]*$/i, "")
    .trim();
}

function formatAnswerForGeneratedPrompt(answer: string, question: string): string {
  if (/respond with (?:the )?character count of the exact answer/i.test(question)) {
    return String(Array.from(answer).length);
  }

  if (/respond with only the terminal segment of the exact answer after the last separator/i.test(question)) {
    const segments = answer.split(/::|[.:/\-_\s]+/).filter((segment) => segment.length > 0);
    return segments.at(-1) ?? answer;
  }

  return answer;
}

function decodeSingleQuotedStringLiteral(raw: string): string {
  let decoded = "";

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      decoded += char;
      continue;
    }

    index += 1;
    if (index >= raw.length) {
      decoded += "\\";
      break;
    }

    const escaped = raw[index];
    switch (escaped) {
      case "'":
      case '"':
      case "\\":
      case "/":
        decoded += escaped;
        break;
      case "b":
        decoded += "\b";
        break;
      case "f":
        decoded += "\f";
        break;
      case "n":
        decoded += "\n";
        break;
      case "r":
        decoded += "\r";
        break;
      case "t":
        decoded += "\t";
        break;
      case "v":
        decoded += "\v";
        break;
      case "0":
        decoded += "\0";
        break;
      case "x": {
        const hex = raw.slice(index + 1, index + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error(`Invalid hex escape: \\x${hex}`);
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 2;
        break;
      }
      case "u": {
        if (raw[index + 1] === "{") {
          const end = raw.indexOf("}", index + 2);
          if (end === -1) throw new Error("Invalid unicode code point escape.");
          const hex = raw.slice(index + 2, end);
          if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`Invalid unicode code point escape: ${hex}`);
          decoded += String.fromCodePoint(Number.parseInt(hex, 16));
          index = end;
          break;
        }
        const hex = raw.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid unicode escape: \\u${hex}`);
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        break;
      }
      default:
        decoded += escaped;
    }
  }

  return decoded;
}

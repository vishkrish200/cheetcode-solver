export interface Level3UiBucketFeedback {
  name: string;
  status: string;
}

export interface Level3PrestartAssignment {
  taskName: string;
  language: string;
}

const STATUS_PATTERN = /^(?:PASS|PASSED|FAIL|FAILED|PENDING|RUNNING|ERROR)$/i;

export function extractLevel3UiFeedbackFromText(text: string): Level3UiBucketFeedback[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const feedback: Level3UiBucketFeedback[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = lines[index];
    const nextLine = lines[index + 1];
    if (!name || !nextLine) continue;
    const status = normalizeUiStatus(nextLine);
    if (status && isLikelyCheckName(name)) {
      feedback.push({ name, status });
      index += 1;
    }
  }
  return feedback;
}

export function extractLevel3PrestartAssignment(text: string): Level3PrestartAssignment | undefined {
  const match = text.match(/Your next Level 3 challenge is\s+(.+?)\s+assigned in\s+(C\+\+|Rust|C)(?=[\s.])/i);
  if (!match?.[1] || !match[2]) return undefined;
  return { taskName: match[1].trim(), language: match[2].trim() };
}

export function describeLevel3TargetMismatch(
  text: string,
  taskName: string | undefined,
  language: string | undefined,
  assignment: Level3PrestartAssignment | undefined = extractLevel3PrestartAssignment(text)
): string | undefined {
  if (!taskName && !language) return undefined;
  if (assignment) {
    if ((!taskName || assignment.taskName === taskName) && (!language || assignment.language === language)) {
      return undefined;
    }
    const target = [taskName ?? "*", language ? `[${language}]` : "[*]"].join(" ");
    return `Visible Level 3 prestart is ${assignment.taskName} [${assignment.language}], not requested ${target}.`;
  }
  if (taskName && text.includes(taskName) && (!language || text.includes(language))) return undefined;
  if (!/Compiler Ready|Start Level 3|Recommended Diagnostic|Your next Level 3 challenge|Assigned/i.test(text)) {
    return undefined;
  }
  const target = [taskName ?? "*", language ? `[${language}]` : "[*]"].join(" ");
  return `Visible Level 3 prestart does not match requested ${target}.`;
}

function isLikelyCheckName(value: string): boolean {
  if (normalizeUiStatus(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (value.length > 140) return false;
  if (/^[{}()[\];#]/.test(value)) return false;
  if (/^(?:Run|Submit|Paste code|Level 3|Assigned language|main\.(?:c|cpp|rs)|C|C\+\+|Rust)$/i.test(value)) {
    return false;
  }
  return /[A-Za-z]/.test(value);
}

function normalizeUiStatus(value: string): string | undefined {
  if (!STATUS_PATTERN.test(value)) return undefined;
  const normalized = value.toUpperCase();
  if (normalized === "PASSED") return "PASS";
  return normalized;
}

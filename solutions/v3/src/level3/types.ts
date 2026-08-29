export interface Level3PreviewResponse {
  challengeId: string;
  taskName: string;
  language: "C++" | "C" | "Rust" | string;
  previewToken: string;
}

export interface Level3Check {
  id: string;
  name: string;
}

export interface Level3Challenge {
  id: string;
  title?: string;
  taskName: string;
  language: "C++" | "C" | "Rust" | string;
  spec: string;
  starterCode: string;
  checks: Level3Check[];
  metadata?: unknown;
}

export interface Level3Session {
  sessionId: string;
  startedAt?: number;
  expiresAt: number;
  level: 3;
  problems: Level3Challenge[];
  scoreSnapshot?: unknown;
}

export interface Level3ValidationResult {
  problemId: string;
  correct: boolean;
  [key: string]: unknown;
}

export interface Level3ValidationResponse {
  compiled?: boolean;
  error?: string;
  staleSession?: boolean;
  expiresAt?: number;
  results: Level3ValidationResult[];
  [key: string]: unknown;
}

export interface Level3ValidateBody {
  sessionId: string;
  challengeId: string;
  code: string;
}

export interface Level3FinishBody {
  sessionId: string;
  github: string;
  timeElapsed: number;
  code: string;
}

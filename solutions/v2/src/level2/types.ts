export const LEVEL2_PROJECTS = ["chromium", "firefox", "libreoffice", "postgres"] as const;

export type Level2Project = (typeof LEVEL2_PROJECTS)[number];

export interface Level2CatalogEntry {
  id: string;
  project: Level2Project;
  question: string;
  answer: string;
  acceptableAnswers?: string[];
}

export interface Level2Problem {
  id: string;
  project?: Level2Project;
  question: string;
}

export interface Level2PreviewProject {
  project?: Level2Project;
  name?: string;
  label?: string;
  ref?: string;
  commit?: string;
  previewToken?: string;
  [key: string]: unknown;
}

export interface Level2PreviewResponse {
  projects: Level2PreviewProject[];
  previewToken: string;
}

export interface Level2Session {
  sessionId: string;
  startedAt?: number;
  expiresAt: number;
  level: 2;
  problems: Level2Problem[];
  scoreSnapshot?: unknown;
}

export interface Level2ValidationResponse {
  results: Array<{
    problemId: string;
    correct: boolean;
  }>;
}

export interface Level2FinishBody {
  sessionId: string;
  github: string;
  timeElapsed: number;
  answers: Record<string, string>;
}

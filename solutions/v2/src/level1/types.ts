export interface CheetTestCase {
  args: unknown[];
  expected: unknown;
  input?: Record<string, unknown>;
}

export interface CheetProblem {
  id: string;
  title: string;
  tier: string;
  description: string;
  signature: string;
  starterCode: string;
  testCases: CheetTestCase[];
  context?: unknown;
}

export interface LevelSession {
  sessionId: string;
  startedAt: number;
  expiresAt: number;
  level: number;
  problems: CheetProblem[];
}

export interface SolvedProblem {
  problemId: string;
  title: string;
  signature: string;
  known: boolean;
  source?: "catalog" | "llm" | "starter";
  validationError?: string;
  code: string;
}

export interface FinishResponse {
  attempt: {
    level: number;
    status: string;
    solved: number;
    total: number;
    score: number;
    elo: number;
    timeRemaining: number;
    exploits?: unknown[];
    landmines?: unknown[];
  };
  progress?: {
    unlockedLevel: number;
  };
}

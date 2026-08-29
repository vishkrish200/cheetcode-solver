import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { STORAGE_STATE_PATH, TARGET_URL } from "../recon/capture.js";
export { DEFAULT_GITHUB_IDENTITY, resolveGithubIdentity } from "../identity.js";
import type { CheetProblem, FinishResponse, LevelSession, SolvedProblem } from "./types.js";

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface StorageState {
  cookies: StorageCookie[];
  origins: unknown[];
}

export interface FingerprintHints {
  profileVersion: number;
  fingerprintId: string;
  fingerprintSource: string;
  collectedAt: number;
  environment: {
    language: string;
    languages: string[];
    timezone: string;
  };
  display: {
    screenWidth: number;
    screenHeight: number;
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
  };
  hardware: {
    hardwareConcurrency: number;
    deviceMemory: number;
    maxTouchPoints: number;
  };
  rendering: {
    webGlVendor: string;
    webGlRenderer: string;
  };
  automation: {
    automationVerdict: string;
    automationConfidence: string;
    reasonCodes: string[];
  };
}

export interface Level1ClientOptions {
  enableReplay?: boolean;
  fingerprintHints?: FingerprintHints;
}

export interface Level1ValidationResult {
  problemId: string;
  passed: boolean;
}

export interface Level1Submission {
  problemId: string;
  code: string;
}

export interface Level1Client {
  startSession: (github: string) => Promise<LevelSession>;
  validateSubmissions: (session: LevelSession, solved: SolvedProblem[]) => Promise<SolvedProblem[]>;
  sendReplay: (session: LevelSession, github: string, eventType: ReplayEventType, solved?: SolvedProblem[]) => Promise<void>;
  startHeartbeat: (session: LevelSession, github: string, getSolved: () => SolvedProblem[]) => () => void;
  finishSession: (session: LevelSession, solved: SolvedProblem[], github: string) => Promise<FinishResponse>;
}

export type ReplayEventType = "session_started" | "state_snapshot" | "heartbeat";

interface ReplaySummary {
  github: string;
  screen: "playing";
  level: 1;
  expiresAt: number;
  totalProblems: number;
  draftCount: number;
  solvedLocal: number;
  isSubmitting: false;
  isRestoringSession: false;
  submitError: null;
  submittedLead: false;
  fingerprint: FingerprintHints;
}

interface ReplaySnapshot {
  type: "level1";
  problems: Array<Pick<CheetProblem, "id" | "title" | "tier">>;
  codes?: Record<string, string>;
  localPass?: Record<string, boolean>;
}

export async function createLevel1Client(options: Level1ClientOptions = {}): Promise<Level1Client> {
  const baseUrl = new URL(TARGET_URL);
  const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
  const cookie = buildCookieHeader(storage.cookies, baseUrl.hostname);
  if (!cookie) {
    throw new Error(`No cookies for ${baseUrl.hostname} in ${STORAGE_STATE_PATH}. Run npm run recon -- auth:comet first.`);
  }

  const configuredFingerprint = options.fingerprintHints ?? (await readFingerprintHintsFromEnv());
  if (!configuredFingerprint && process.env.CHEETCODE_ALLOW_SYNTHETIC_FINGERPRINT !== "1") {
    throw new Error(
      "No browser-derived fingerprint hints configured. Extract them from a captured /api/session request and set CHEETCODE_FINGERPRINT_HINTS_PATH, or explicitly opt into the known-invalid direct fallback with CHEETCODE_ALLOW_SYNTHETIC_FINGERPRINT=1."
    );
  }
  const fingerprintId = configuredFingerprint?.fingerprintId ?? crypto.randomBytes(16).toString("hex");
  const commonHeaders: Record<string, string> = {
    "content-type": "application/json",
    referer: TARGET_URL,
    cookie,
    "x-client-fingerprint": fingerprintId
  };
  if (process.env.CHEETCODE_USER_AGENT) commonHeaders["user-agent"] = process.env.CHEETCODE_USER_AGENT;
  // ponytail: server's own 401 hint documents Bearer PAT as the sanctioned API auth; supplied via env, never logged.
  if (process.env.CHEETCODE_GITHUB_PAT) commonHeaders["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

  const postJson = async <T>(urlPath: string, body: unknown): Promise<T> => {
    const response = await fetch(new URL(urlPath, TARGET_URL), {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${urlPath} failed with ${response.status}: ${text.slice(0, 1000)}`);
    }
    return JSON.parse(text) as T;
  };

  const fingerprintHints = configuredFingerprint ?? buildFingerprintHints(fingerprintId, Date.now());

  const sendReplay = async (
    session: LevelSession,
    github: string,
    eventType: ReplayEventType,
    solved: SolvedProblem[] = []
  ): Promise<void> => {
    await postJson("/api/session/replay", {
      sessionId: session.sessionId,
      level: 1,
      eventType,
      screen: "playing",
      route: "/",
      clientAt: Date.now(),
      summary: buildReplaySummary(session, github, fingerprintHints, solved),
      ...(eventType === "heartbeat" ? {} : { snapshot: buildReplaySnapshot(session.problems, solved) })
    });
  };

  return {
    startSession: async (github) => {
      const session = await postJson<LevelSession>("/api/session", {
        level: 1,
        isDev: false,
        fingerprintHints
      });
      if (options.enableReplay) await sendReplay(session, github, "session_started");
      return session;
    },
    validateSubmissions: async (session, solved) => {
      const results = await Promise.all(
        solved.map(async (problem): Promise<SolvedProblem> => {
          const validation = await postJson<Level1ValidationResult>("/api/level-1/validate", {
            sessionId: session.sessionId,
            ...buildLevel1Submissions([problem])[0]
          });
          if (validation.passed !== true) {
            throw new Error(`Server rejected ${problem.problemId}`);
          }
          return problem;
        })
      );
      return results;
    },
    sendReplay,
    startHeartbeat: (session, github, getSolved) => {
      const timer = setInterval(() => {
        void sendReplay(session, github, "heartbeat", getSolved()).catch((error) => {
          console.warn(`Level 1 heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, 5_000);
      return () => clearInterval(timer);
    },
    finishSession: (session, solved, github) =>
      postJson<FinishResponse>("/api/level-1/finish", {
        sessionId: session.sessionId,
        github,
        timeElapsed: elapsedForSession(session),
        submissions: buildLevel1Submissions(solved)
      })
  };
}

export function buildLevel1Submissions(solved: SolvedProblem[]): Level1Submission[] {
  return solved.map(({ problemId, code }) => ({ problemId, code }));
}

export function buildReplaySummary(
  session: LevelSession,
  github: string,
  fingerprint: FingerprintHints,
  solved: SolvedProblem[]
): ReplaySummary {
  return {
    github,
    screen: "playing",
    level: 1,
    expiresAt: session.expiresAt,
    totalProblems: session.problems.length,
    draftCount: session.problems.length,
    solvedLocal: solved.filter((problem) => problem.known).length,
    isSubmitting: false,
    isRestoringSession: false,
    submitError: null,
    submittedLead: false,
    fingerprint
  };
}

export function buildReplaySnapshot(problems: CheetProblem[], solved: SolvedProblem[]): ReplaySnapshot {
  const solvedById = new Map(solved.map((problem) => [problem.problemId, problem]));
  return {
    type: "level1",
    problems: problems.map(({ id, title, tier }) => ({ id, title, tier })),
    codes: Object.fromEntries(problems.map((problem) => [problem.id, solvedById.get(problem.id)?.code ?? problem.starterCode])),
    localPass: Object.fromEntries(solved.filter((problem) => problem.known).map((problem) => [problem.problemId, true]))
  };
}

export function elapsedForSession(session: Pick<LevelSession, "expiresAt">): number {
  return Math.max(0, 60_000 - (session.expiresAt - Date.now()));
}

export function buildCookieHeader(cookies: StorageCookie[], hostname: string): string {
  return cookies
    .filter((cookie) => cookieMatchesHost(cookie.domain, hostname))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export function buildFingerprintHints(fingerprintId: string, collectedAt: number): FingerprintHints {
  return {
    profileVersion: 1,
    fingerprintId,
    fingerprintSource: "direct",
    collectedAt,
    environment: {
      language: "en-US",
      languages: ["en-US"],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Calcutta"
    },
    display: {
      screenWidth: 1440,
      screenHeight: 1000,
      innerWidth: 1440,
      innerHeight: 1000,
      devicePixelRatio: 1
    },
    hardware: {
      hardwareConcurrency: 12,
      deviceMemory: 16,
      maxTouchPoints: 0
    },
    rendering: {
      webGlVendor: "Google Inc. (Apple)",
      webGlRenderer: "ANGLE (Apple, ANGLE Metal Renderer)"
    },
    automation: {
      automationVerdict: "direct_api_client",
      automationConfidence: "high",
      reasonCodes: ["node_fetch"]
    }
  };
}

export async function readFingerprintHintsFromEnv(): Promise<FingerprintHints | undefined> {
  const filePath = process.env.CHEETCODE_FINGERPRINT_HINTS_PATH?.trim();
  if (!filePath) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read CHEETCODE_FINGERPRINT_HINTS_PATH=${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || typeof (parsed as { fingerprintId?: unknown }).fingerprintId !== "string") {
    throw new Error(`Fingerprint hints at ${filePath} must contain a string fingerprintId.`);
  }
  return parsed as FingerprintHints;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cookieMatchesHost(domain: string, hostname: string): boolean {
  const normalized = domain.startsWith(".") ? domain.slice(1) : domain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

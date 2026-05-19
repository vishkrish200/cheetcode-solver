import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { STORAGE_STATE_PATH, TARGET_URL } from "../recon/capture.js";
import type { FinishResponse, LevelSession, SolvedProblem } from "./types.js";

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

interface FingerprintHints {
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

export interface Level1Client {
  startSession: () => Promise<LevelSession>;
  finishSession: (session: LevelSession, solved: SolvedProblem[], github: string) => Promise<FinishResponse>;
}

export async function createLevel1Client(): Promise<Level1Client> {
  const baseUrl = new URL(TARGET_URL);
  const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
  const cookie = buildCookieHeader(storage.cookies, baseUrl.hostname);
  if (!cookie) {
    throw new Error(`No cookies for ${baseUrl.hostname} in ${STORAGE_STATE_PATH}. Run npm run recon -- auth:comet first.`);
  }

  const fingerprintId = crypto.randomBytes(16).toString("hex");
  const commonHeaders = {
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="147", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    referer: TARGET_URL,
    cookie,
    "x-client-fingerprint": fingerprintId
  };

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

  return {
    startSession: () =>
      postJson<LevelSession>("/api/session", {
        level: 1,
        isDev: false,
        fingerprintHints: buildFingerprintHints(fingerprintId, Date.now())
      }),
    finishSession: (session, solved, github) =>
      postJson<FinishResponse>("/api/level-1/finish", {
        sessionId: session.sessionId,
        github,
        timeElapsed: Math.max(0, Date.now() - session.startedAt),
        submissions: solved.map((problem) => ({
          problemId: problem.problemId,
          code: problem.code
        }))
      })
  };
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

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cookieMatchesHost(domain: string, hostname: string): boolean {
  const normalized = domain.startsWith(".") ? domain.slice(1) : domain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

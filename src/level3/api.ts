import crypto from "node:crypto";
import { promises as fs } from "node:fs";

import { buildCookieHeader, buildFingerprintHints } from "../level1/api.js";
import type { FinishResponse } from "../level1/types.js";
import { STORAGE_STATE_PATH, TARGET_URL } from "../recon/capture.js";
import type {
  Level3FinishBody,
  Level3PreviewResponse,
  Level3Session,
  Level3ValidateBody,
  Level3ValidationResponse
} from "./types.js";

interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: unknown[];
}

export interface Level3Client {
  preview: () => Promise<Level3PreviewResponse>;
  startSession: (previewToken: string) => Promise<Level3Session>;
  validateCode: (sessionId: string, challengeId: string, code: string) => Promise<Level3ValidationResponse>;
  finishSession: (
    session: Pick<Level3Session, "sessionId" | "startedAt">,
    code: string,
    github: string,
    timeElapsed?: number
  ) => Promise<FinishResponse>;
}

export interface Level3ClientOptions {
  fingerprintId?: string;
}

export async function createLevel3Client(options: Level3ClientOptions = {}): Promise<Level3Client> {
  const baseUrl = new URL(TARGET_URL);
  const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
  const cookie = buildCookieHeader(storage.cookies, baseUrl.hostname);
  if (!cookie) {
    throw new Error(`No cookies for ${baseUrl.hostname} in ${STORAGE_STATE_PATH}. Run npm run recon -- auth:comet first.`);
  }

  const fingerprintId = options.fingerprintId ?? crypto.randomBytes(16).toString("hex");
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

  const requestJson = async <T>(urlPath: string, init: RequestInit): Promise<T> => {
    const response = await fetch(new URL(urlPath, TARGET_URL), {
      ...init,
      headers: {
        ...commonHeaders,
        ...init.headers
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${urlPath} failed with ${response.status}: ${text.slice(0, 1000)}`);
    }
    return JSON.parse(text) as T;
  };

  const postJson = async <T>(urlPath: string, body: unknown): Promise<T> =>
    requestJson<T>(urlPath, {
      method: "POST",
      body: JSON.stringify(body)
    });

  return {
    preview: () => requestJson<Level3PreviewResponse>("/api/level-3/preview", { method: "GET" }),
    startSession: (previewToken) =>
      postJson<Level3Session>("/api/session", {
        level: 3,
        isDev: false,
        previewToken,
        fingerprintHints: buildFingerprintHints(fingerprintId, Date.now())
      }),
    validateCode: (sessionId, challengeId, code) =>
      postJson<Level3ValidationResponse>("/api/level-3/validate", buildLevel3ValidateBody({ sessionId, challengeId, code })),
    finishSession: (session, code, github, timeElapsed) =>
      postJson<FinishResponse>(
        "/api/level-3/finish",
        buildLevel3FinishBody({
          sessionId: session.sessionId,
          github,
          timeElapsed: timeElapsed ?? Math.max(0, Date.now() - (session.startedAt ?? Date.now())),
          code
        })
      )
  };
}

export function buildLevel3ValidateBody(body: Level3ValidateBody): Level3ValidateBody {
  return {
    sessionId: body.sessionId,
    challengeId: body.challengeId,
    code: body.code
  };
}

export function buildLevel3FinishBody(body: Level3FinishBody): Level3FinishBody {
  return {
    sessionId: body.sessionId,
    github: body.github,
    timeElapsed: body.timeElapsed,
    code: body.code
  };
}

export function allLevel3ChecksPassed(validation: Level3ValidationResponse, expectedTotal?: number): boolean {
  if (validation.compiled === false) return false;
  const results = validation.results ?? [];
  if (expectedTotal !== undefined && results.length < expectedTotal) return false;
  return results.length > 0 && results.every((result) => result.correct);
}

import crypto from "node:crypto";
import { promises as fs } from "node:fs";

import { STORAGE_STATE_PATH, TARGET_URL } from "../recon/capture.js";
import { buildCookieHeader, buildFingerprintHints } from "../level1/api.js";
import type {
  Level2FinishBody,
  Level2PreviewResponse,
  Level2Session,
  Level2ValidationResponse
} from "./types.js";
import type { FinishResponse } from "../level1/types.js";

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

export interface Level2Client {
  preview: () => Promise<Level2PreviewResponse>;
  startSession: (previewToken: string) => Promise<Level2Session>;
  validateAnswers: (sessionId: string, answers: Record<string, string>) => Promise<Level2ValidationResponse>;
  finishSession: (
    session: Pick<Level2Session, "sessionId" | "startedAt">,
    answers: Record<string, string>,
    github: string,
    timeElapsed?: number
  ) => Promise<FinishResponse>;
}

export async function createLevel2Client(): Promise<Level2Client> {
  const baseUrl = new URL(TARGET_URL);
  const storage = JSON.parse(await fs.readFile(STORAGE_STATE_PATH, "utf8")) as StorageState;
  const cookie = buildCookieHeader(storage.cookies, baseUrl.hostname);
  if (!cookie) {
    throw new Error(`No cookies for ${baseUrl.hostname} in ${STORAGE_STATE_PATH}. Run npm run recon -- auth first.`);
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
    preview: () => requestJson<Level2PreviewResponse>("/api/level-2/preview", { method: "GET" }),
    startSession: (previewToken) =>
      postJson<Level2Session>("/api/session", {
        level: 2,
        isDev: false,
        previewToken,
        fingerprintHints: buildFingerprintHints(fingerprintId, Date.now())
      }),
    validateAnswers: (sessionId, answers) =>
      postJson<Level2ValidationResponse>("/api/level-2/validate", {
        sessionId,
        answers
      }),
    finishSession: (session, answers, github, timeElapsed) =>
      postJson<FinishResponse>(
        "/api/level-2/finish",
        buildLevel2FinishBody({
          sessionId: session.sessionId,
          github,
          timeElapsed: timeElapsed ?? Math.max(0, Date.now() - (session.startedAt ?? Date.now())),
          answers
        })
      )
  };
}

export function buildLevel2FinishBody(body: Level2FinishBody): Level2FinishBody {
  return {
    sessionId: body.sessionId,
    github: body.github,
    timeElapsed: body.timeElapsed,
    answers: body.answers
  };
}

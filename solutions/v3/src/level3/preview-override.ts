import type { Level3PreviewResponse } from "./types.js";

export function resolveLevel3PreviewOverride(env: NodeJS.ProcessEnv): Level3PreviewResponse | undefined {
  const previewToken = env.LEVEL3_PREVIEW_TOKEN?.trim();
  if (!previewToken) return undefined;

  return {
    challengeId: env.LEVEL3_CHALLENGE_ID?.trim() || "pinned",
    taskName: env.LEVEL3_TASK_NAME?.trim() || "pinned",
    language: env.LEVEL3_LANGUAGE?.trim() || "unknown",
    previewToken
  };
}

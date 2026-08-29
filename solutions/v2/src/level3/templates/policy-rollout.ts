import { readFileSync } from "node:fs";

export function renderPolicyRolloutTemplate(language: string): string {
  if (language !== "C") {
    throw new Error(`No Versioned Policy Rollout template for ${language}.`);
  }
  return readFileSync(new URL("./policy-rollout.c", import.meta.url), "utf8");
}

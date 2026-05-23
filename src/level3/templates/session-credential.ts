import { readFileSync } from "node:fs";

export function renderSessionCredentialTemplate(language: string): string {
  if (language !== "C") {
    throw new Error(`No Session Credential Rotation template for ${language}.`);
  }
  return readFileSync(new URL("./session-credential.c", import.meta.url), "utf8");
}

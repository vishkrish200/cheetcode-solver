import { renderCpuEmulatorTemplate } from "./cpu-emulator.js";
import { renderPolicyRolloutTemplate } from "./policy-rollout.js";
import { renderSessionCredentialTemplate } from "./session-credential.js";
import { solveTraitExpressionTask } from "../specialists/trait-expression.js";

export function renderLevel3FamilyTemplate(taskName: string, language: string): string | undefined {
  if (taskName === "16-bit CPU Emulator" && (language === "C" || language === "C++")) {
    return renderCpuEmulatorTemplate(language);
  }
  if (taskName === "Trait Expression AST" && language === "C") {
    return solveTraitExpressionTask(taskName, language);
  }
  if (taskName === "Session Credential Rotation Compat Registry" && language === "C") {
    return renderSessionCredentialTemplate(language);
  }
  if (taskName === "Versioned Policy Rollout Engine" && language === "C") {
    return renderPolicyRolloutTemplate(language);
  }
  return undefined;
}

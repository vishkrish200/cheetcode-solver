export type Level3SolverMode = "dynamic" | "hybrid" | "specialist" | "candidate";

export const DEFAULT_LEVEL3_SOLVER_MODE: Level3SolverMode = "hybrid";

export function parseLevel3SolverMode(value: string | undefined): Level3SolverMode {
  const mode = value?.trim() || DEFAULT_LEVEL3_SOLVER_MODE;
  if (mode === "dynamic" || mode === "hybrid" || mode === "specialist" || mode === "candidate") return mode;
  throw new Error(`Invalid LEVEL3_SOLVER_MODE '${value}'. Expected dynamic, hybrid, specialist, or candidate.`);
}

export function shouldUseLevel3RegisteredCandidate(env: Pick<NodeJS.ProcessEnv, string>): boolean {
  if (env.LEVEL3_USE_REGISTERED === "1") return true;
  const solverMode = parseLevel3SolverMode(env.LEVEL3_SOLVER_MODE);
  return solverMode === "hybrid" || solverMode === "candidate";
}

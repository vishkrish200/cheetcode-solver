import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEVEL3_SOLVER_MODE,
  parseLevel3SolverMode,
  shouldUseLevel3RegisteredCandidate
} from "../src/level3/solver-mode.js";

describe("Level 3 solver mode", () => {
  it("defaults to hybrid so known challenge families use registered candidates first", () => {
    expect(DEFAULT_LEVEL3_SOLVER_MODE).toBe("hybrid");
    expect(parseLevel3SolverMode(undefined)).toBe("hybrid");
    expect(parseLevel3SolverMode("")).toBe("hybrid");
  });

  it("accepts explicit solver modes", () => {
    expect(parseLevel3SolverMode("dynamic")).toBe("dynamic");
    expect(parseLevel3SolverMode("hybrid")).toBe("hybrid");
    expect(parseLevel3SolverMode("specialist")).toBe("specialist");
    expect(parseLevel3SolverMode("candidate")).toBe("candidate");
  });

  it("rejects invalid solver modes", () => {
    expect(() => parseLevel3SolverMode("random")).toThrow(/Invalid LEVEL3_SOLVER_MODE/);
  });

  it("can force registered candidates before dynamic synthesis", () => {
    expect(shouldUseLevel3RegisteredCandidate({ LEVEL3_SOLVER_MODE: "dynamic" })).toBe(false);
    expect(
      shouldUseLevel3RegisteredCandidate({
        LEVEL3_SOLVER_MODE: "dynamic",
        LEVEL3_USE_REGISTERED: "1"
      })
    ).toBe(true);
    expect(shouldUseLevel3RegisteredCandidate({ LEVEL3_SOLVER_MODE: "hybrid" })).toBe(true);
    expect(shouldUseLevel3RegisteredCandidate({ LEVEL3_SOLVER_MODE: "candidate" })).toBe(true);
  });
});

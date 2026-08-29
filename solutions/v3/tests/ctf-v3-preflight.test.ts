import { describe, expect, it } from "vitest";

import { assertExpectedV3Contract, parsePublicContract } from "../src/ctf-v3-preflight.js";

const html = '<title>CheetCode v3</title><meta name="description" content="3 levels. 60 problems. 240 seconds. Good luck.">';
const bundle = [
  "const PROBLEMS_PER_SESSION=25,LEVEL2_TOTAL=10,LEVEL3_TOTAL=25,LEVEL2_DURATION_SECONDS=60,LEVEL3_DURATION_SECONDS=120,TOTAL_DURATION_SECONDS=240;",
  'fetch("/api/session");fetch("/api/session/restore");fetch("/api/session/replay");',
  'fetch("/api/level-1/validate");fetch("/api/level-1/finish");',
  'fetch("/api/level-2/preview");fetch("/api/level-3/preview");'
].join("\n");

describe("v3 public contract preflight", () => {
  it("extracts and validates the expected deployed contract", () => {
    const contract = parsePublicContract(html, bundle);
    expect(() => assertExpectedV3Contract(contract)).not.toThrow();
    expect(contract.constants).toEqual({
      problemsPerSession: 25,
      level2Total: 10,
      level3Total: 25,
      level2DurationSeconds: 60,
      level3DurationSeconds: 120,
      totalDurationSeconds: 240
    });
  });

  it("fails closed when the deployed challenge changes", () => {
    const contract = parsePublicContract(html, bundle.replace("LEVEL3_TOTAL=25", "LEVEL3_TOTAL=24"));
    expect(() => assertExpectedV3Contract(contract)).toThrow(/level3Total/);
  });
});

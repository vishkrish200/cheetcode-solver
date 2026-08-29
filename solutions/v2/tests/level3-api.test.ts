import { describe, expect, it } from "vitest";

import { allLevel3ChecksPassed, buildLevel3FinishBody, buildLevel3ValidateBody } from "../src/level3/api.js";

describe("Level 3 API payloads", () => {
  it("matches the client bundle's validate payload shape", () => {
    expect(buildLevel3ValidateBody({ sessionId: "sess", challengeId: "challenge", code: "int main(){}" })).toEqual({
      sessionId: "sess",
      challengeId: "challenge",
      code: "int main(){}"
    });
  });

  it("matches the client bundle's finish payload shape", () => {
    expect(buildLevel3FinishBody({ sessionId: "sess", github: "example-user", timeElapsed: 42, code: "int main(){}" })).toEqual({
      sessionId: "sess",
      github: "example-user",
      timeElapsed: 42,
      code: "int main(){}"
    });
  });
});

describe("allLevel3ChecksPassed", () => {
  it("requires compilation and all expected checks to pass", () => {
    expect(
      allLevel3ChecksPassed(
        {
          compiled: true,
          results: [
            { problemId: "a", correct: true },
            { problemId: "b", correct: true }
          ]
        },
        2
      )
    ).toBe(true);

    expect(allLevel3ChecksPassed({ compiled: false, results: [{ problemId: "a", correct: true }] }, 1)).toBe(false);
    expect(allLevel3ChecksPassed({ compiled: true, results: [{ problemId: "a", correct: true }] }, 2)).toBe(false);
  });
});

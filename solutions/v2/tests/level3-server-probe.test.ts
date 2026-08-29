import { describe, expect, it } from "vitest";

import {
  parseProbeCodeFiles,
  scoreLevel3Validation,
  selectBestProbeResult,
  sourceExtensionForLevel3Language
} from "../src/level3/server-probe.js";

describe("parseProbeCodeFiles", () => {
  it("parses comma-separated code paths and derives stable labels", () => {
    expect(parseProbeCodeFiles(" one.c, /tmp/two.cpp ,nested/three.rs ")).toEqual([
      { label: "one", path: "one.c" },
      { label: "two", path: "/tmp/two.cpp" },
      { label: "three", path: "nested/three.rs" }
    ]);
  });

  it("supports explicit labels", () => {
    expect(parseProbeCodeFiles("base=one.c,variant-a=/tmp/two.cpp")).toEqual([
      { label: "base", path: "one.c" },
      { label: "variant-a", path: "/tmp/two.cpp" }
    ]);
  });

  it("ignores empty entries", () => {
    expect(parseProbeCodeFiles(" , one.c,, ")).toEqual([{ label: "one", path: "one.c" }]);
  });
});

describe("scoreLevel3Validation", () => {
  it("uses explicit pass and total counts when the server provides them", () => {
    expect(
      scoreLevel3Validation({
        compiled: true,
        passCount: 7,
        totalCount: 25,
        results: [{ problemId: "a", name: "Behavior Bucket 1", correct: true }]
      })
    ).toMatchObject({
      compiled: true,
      passCount: 7,
      totalCount: 25,
      failedNames: []
    });
  });

  it("falls back to result rows and keeps bucket names", () => {
    expect(
      scoreLevel3Validation({
        compiled: true,
        results: [
          { problemId: "a", name: "Behavior Bucket 1", correct: true },
          { problemId: "b", name: "Scale Budget 9", correct: false }
        ]
      })
    ).toEqual({
      compiled: true,
      passCount: 1,
      totalCount: 2,
      failCount: 1,
      passedNames: ["Behavior Bucket 1"],
      failedNames: ["Scale Budget 9"]
    });
  });

  it("treats server compile failure as zero useful passes", () => {
    expect(scoreLevel3Validation({ compiled: false, error: "syntax", results: [] })).toMatchObject({
      compiled: false,
      passCount: 0,
      totalCount: 0,
      failCount: 0
    });
  });
});

describe("selectBestProbeResult", () => {
  it("prefers the locally compiled variant with the best server score", () => {
    const best = selectBestProbeResult([
      { label: "broken", localCompileOk: false },
      {
        label: "base",
        localCompileOk: true,
        validation: { compiled: true, passCount: 12, totalCount: 25, results: [] }
      },
      {
        label: "variant",
        localCompileOk: true,
        validation: { compiled: true, passCount: 18, totalCount: 25, results: [] }
      }
    ]);

    expect(best?.label).toBe("variant");
  });
});

describe("sourceExtensionForLevel3Language", () => {
  it("maps supported languages to judge source extensions", () => {
    expect(sourceExtensionForLevel3Language("C")).toBe("c");
    expect(sourceExtensionForLevel3Language("C++")).toBe("cpp");
    expect(sourceExtensionForLevel3Language("Rust")).toBe("rs");
    expect(sourceExtensionForLevel3Language("Zig")).toBe("txt");
  });
});

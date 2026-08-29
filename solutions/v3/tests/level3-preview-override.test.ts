import { describe, expect, it } from "vitest";

import { resolveLevel3PreviewOverride } from "../src/level3/preview-override.js";

describe("resolveLevel3PreviewOverride", () => {
  it("builds a preview object from pinned environment values", () => {
    expect(
      resolveLevel3PreviewOverride({
        LEVEL3_PREVIEW_TOKEN: "token",
        LEVEL3_CHALLENGE_ID: "l3:trait-expression-ast:c",
        LEVEL3_TASK_NAME: "Trait Expression AST",
        LEVEL3_LANGUAGE: "C"
      })
    ).toEqual({
      challengeId: "l3:trait-expression-ast:c",
      taskName: "Trait Expression AST",
      language: "C",
      previewToken: "token"
    });
  });

  it("returns undefined when no preview token is pinned", () => {
    expect(resolveLevel3PreviewOverride({})).toBeUndefined();
  });
});

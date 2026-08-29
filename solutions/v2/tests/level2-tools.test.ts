import { describe, expect, it } from "vitest";

import { solveLevel2WithTools } from "../src/level2/tools.js";
import type { Level2CatalogEntry, Level2PreviewResponse, Level2Problem } from "../src/level2/types.js";

describe("solveLevel2WithTools", () => {
  it("answers matching problems from the extracted catalog without source search", async () => {
    const catalog: Level2CatalogEntry[] = [
      {
        id: "ff_known",
        project: "firefox",
        question: "Which internal flag wins?",
        answer: "nsExactFlag"
      }
    ];
    const problems: Level2Problem[] = [
      {
        id: "runtime_1",
        project: "firefox",
        question:
          "Which internal flag wins?\n\nRespond with only the terminal segment of the exact answer after the last separator (::, ., :, /, -, _, or whitespace)."
      }
    ];
    const preview: Level2PreviewResponse = {
      projects: [{ project: "firefox", commit: "abc123" }],
      previewToken: "preview"
    };

    const result = await solveLevel2WithTools(problems, preview, {
      catalog,
      sourceSearch: false
    });

    expect(result.answers).toEqual({ runtime_1: "nsExactFlag" });
    expect(result.diagnostics.catalogHits).toEqual(["runtime_1"]);
    expect(result.diagnostics.misses).toEqual([]);
  });

  it("reports misses without falling back to guesses when tool evidence is unavailable", async () => {
    const problems: Level2Problem[] = [
      {
        id: "runtime_missing",
        project: "postgres",
        question: "Which token is emitted?"
      }
    ];
    const preview: Level2PreviewResponse = {
      projects: [{ project: "postgres", commit: "abc123" }],
      previewToken: "preview"
    };

    const result = await solveLevel2WithTools(problems, preview, {
      catalog: [],
      sourceSearch: false
    });

    expect(result.answers).toEqual({});
    expect(result.diagnostics.catalogHits).toEqual([]);
    expect(result.diagnostics.misses).toEqual(["runtime_missing"]);
  });
});

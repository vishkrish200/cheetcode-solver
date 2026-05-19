import { describe, expect, it } from "vitest";

import { buildAnswersForLevel2Session, extractLevel2CatalogFromBundle, findLevel2Answer } from "../src/level2/catalog.js";
import { buildLevel2FinishBody } from "../src/level2/api.js";
import type { Level2Problem } from "../src/level2/types.js";

const bundle = String.raw`(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([
  "object"==typeof document?document.currentScript:void 0,
  13621,
  (e,t,i)=>{t.exports=JSON.parse('[{"id":"ff_1","project":"firefox","question":"Which token wins?","answer":"TOKEN","acceptableAnswers":["TOKEN","Token"]},{"id":"l2_1","project":"chromium","question":"What status code name is returned?","answer":"kOperationAborted","acceptableAnswers":["kOperationAborted","9"]}]')}
]);`;

describe("extractLevel2CatalogFromBundle", () => {
  it("parses the embedded JSON.parse question bank from a Turbopack bundle", () => {
    const catalog = extractLevel2CatalogFromBundle(bundle);

    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toMatchObject({
      id: "ff_1",
      project: "firefox",
      answer: "TOKEN",
      acceptableAnswers: ["TOKEN", "Token"]
    });
  });
});

describe("findLevel2Answer", () => {
  it("prefers exact problem id matches", () => {
    const catalog = extractLevel2CatalogFromBundle(bundle);

    expect(findLevel2Answer(catalog, { id: "l2_1", project: "chromium", question: "changed wording" })?.answer).toBe(
      "kOperationAborted"
    );
  });

  it("falls back to normalized project plus question text", () => {
    const catalog = extractLevel2CatalogFromBundle(bundle);

    expect(
      findLevel2Answer(catalog, {
        id: "runtime_id",
        project: "firefox",
        question: "  Which   token wins? "
      })?.answer
    ).toBe("TOKEN");
  });

  it("builds the answer map expected by the Level 2 finish endpoint", () => {
    const catalog = extractLevel2CatalogFromBundle(bundle);
    const problems: Level2Problem[] = [
      { id: "ff_1", project: "firefox", question: "Which token wins?" },
      { id: "l2_1", project: "chromium", question: "What status code name is returned?" }
    ];

    expect(buildAnswersForLevel2Session(catalog, problems)).toEqual({
      ff_1: "TOKEN",
      l2_1: "kOperationAborted"
    });
  });

  it("applies prompt-level answer formatting instructions from generated problems", () => {
    const catalog = extractLevel2CatalogFromBundle(bundle);
    const problems: Level2Problem[] = [
      {
        id: "runtime_a",
        project: "firefox",
        question: "Which token wins?\n\nRespond with the character count of the exact answer."
      },
      {
        id: "runtime_b",
        project: "chromium",
        question:
          "What status code name is returned?\n\nRespond with only the terminal segment of the exact answer after the last separator (::, ., :, /, -, _, or whitespace)."
      }
    ];

    expect(buildAnswersForLevel2Session(catalog, problems)).toEqual({
      runtime_a: "5",
      runtime_b: "kOperationAborted"
    });
  });
});

describe("buildLevel2FinishBody", () => {
  it("matches the client bundle's finish payload shape", () => {
    expect(
      buildLevel2FinishBody({
        sessionId: "sess",
        github: "trimax-eng",
        timeElapsed: 1234,
        answers: { ff_1: "TOKEN" }
      })
    ).toEqual({
      sessionId: "sess",
      github: "trimax-eng",
      timeElapsed: 1234,
      answers: { ff_1: "TOKEN" }
    });
  });
});

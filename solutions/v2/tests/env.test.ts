import { describe, expect, it } from "vitest";

import { parseEnvFile } from "../src/env.js";

describe("parseEnvFile", () => {
  it("parses simple and quoted env values", () => {
    expect(
      parseEnvFile(`
# comment
FOO=bar
QUOTED="hello world"
SINGLE='ok'
BAD-KEY=nope
`)
    ).toEqual({
      FOO: "bar",
      QUOTED: "hello world",
      SINGLE: "ok"
    });
  });
});

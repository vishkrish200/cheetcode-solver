import { describe, expect, it } from "vitest";

import { parseSizeOutput } from "../src/level3/local-compile.js";

describe("parseSizeOutput", () => {
  it("parses GNU size output", () => {
    expect(
      parseSizeOutput(`
   text    data     bss     dec     hex filename
   1234     456     789    2479     9af a.so
`)
    ).toBe(2479);
  });

  it("parses macOS size output", () => {
    expect(
      parseSizeOutput(`
__TEXT  __DATA __OBJC others dec hex
16384 2420162560 0 32768 2420211712 90418000 /tmp/a.so
`)
    ).toBe(2420211712);
  });
});

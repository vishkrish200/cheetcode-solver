import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { buildSafariLevel1Bridge } from "../src/safari-level1-bridge.js";

describe("Safari Level 1 bridge", () => {
  it("builds a syntactically valid, secret-free bridge for the complete catalog", async () => {
    const script = await buildSafariLevel1Bridge({ github: "trimax-3" });

    expect(() => new vm.Script(script)).not.toThrow();
    expect(script).toContain('"github":"trimax-3"');
    expect(script).toContain('"submissionLimit":25');
    expect(script).toContain("calculateMigrationDistance");
    expect(script).toContain("whichwarehouse");
    expect(script).not.toContain("__Secure-authjs.session-token");
    expect(script).not.toContain("ctf_fp=");
  });

  it("rejects an invalid identity or limit", async () => {
    await expect(buildSafariLevel1Bridge({ github: "not valid" })).rejects.toThrow(/Invalid GitHub identity/);
    await expect(buildSafariLevel1Bridge({ github: "trimax-3", submissionLimit: 0 })).rejects.toThrow(/submissionLimit/);
  });
});

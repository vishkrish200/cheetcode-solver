import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("documents the dedicated non-timed catalog script", () => {
    const source = readFileSync(path.resolve("src/level3-runner.ts"), "utf8");
    expect(source).toContain("npm run level3:catalog");
    expect(source).not.toContain("npm run level3 -- catalog");
  });

  it("routes live Level 3 through registered components by default", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.level3).toContain("LEVEL3_USE_REGISTERED=1");
    expect(packageJson.scripts.level3).toContain("LEVEL3_SKELETON_HOLES=1");
    expect(packageJson.scripts["level3:components:preflight"]).toBe("tsx src/level3-component-preflight.ts");
  });

  it("exposes speed-demon shortcuts for Level 2 and Level 3", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["level2:speed-demon"]).toContain("LEVEL2_SPEED_DEMON=1");
    expect(packageJson.scripts["level2:speed-demon"]).toContain("src/level2-runner.ts");
    expect(packageJson.scripts["level3:speed-demon"]).toContain("LEVEL3_SPEED_DEMON=1");
    expect(packageJson.scripts["level3:speed-demon"]).toContain("src/level3-runner.ts");
  });
});

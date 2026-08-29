import { describe, expect, it } from "vitest";

import { buildCookieHeader, buildFingerprintHints } from "../src/level1/api.js";

describe("buildCookieHeader", () => {
  it("includes cookies matching the target host and excludes unrelated domains", () => {
    const header = buildCookieHeader(
      [
        { name: "a", value: "1", domain: "ctf.firecrawl.dev", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "b", value: "2", domain: ".firecrawl.dev", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "c", value: "3", domain: "github.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }
      ],
      "ctf.firecrawl.dev"
    );

    expect(header).toBe("a=1; b=2");
  });
});

describe("buildFingerprintHints", () => {
  it("keeps the header fingerprint and body fingerprint aligned", () => {
    const hints = buildFingerprintHints("abc123", 1234);

    expect(hints.fingerprintId).toBe("abc123");
    expect(hints.collectedAt).toBe(1234);
    expect(hints.environment.timezone).toBeTruthy();
  });
});

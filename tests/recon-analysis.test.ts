import { describe, expect, it } from "vitest";

import {
  buildEndpointSummaries,
  classifyEndpoint,
  routeKeyFromUrl
} from "../src/recon/analyze.js";
import { chromeTimeToUnixSeconds, mapChromeSameSite } from "../src/recon/comet.js";
import { redactHeaders } from "../src/recon/redact.js";
import type { NetworkRecord } from "../src/recon/types.js";

describe("redactHeaders", () => {
  it("redacts authentication-bearing headers while preserving safe headers", () => {
    const redacted = redactHeaders({
      Authorization: "Bearer secret",
      cookie: "session=secret",
      "Set-Cookie": "session=secret",
      "x-api-key": "secret",
      "content-type": "application/json",
      accept: "application/json"
    });

    expect(redacted).toEqual({
      Authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "Set-Cookie": "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "content-type": "application/json",
      accept: "application/json"
    });
  });
});

describe("routeKeyFromUrl", () => {
  it("groups requests by method, origin, and pathname while ignoring query strings", () => {
    expect(routeKeyFromUrl("POST", "https://ctf.firecrawl.dev/api/run?id=123")).toBe(
      "POST https://ctf.firecrawl.dev/api/run"
    );
  });
});

describe("classifyEndpoint", () => {
  it("spots likely problem, submit, websocket, and bundle endpoints", () => {
    expect(classifyEndpoint({ method: "GET", url: "https://ctf.firecrawl.dev/api/problems" })).toContain(
      "problem-feed"
    );
    expect(classifyEndpoint({ method: "POST", url: "https://ctf.firecrawl.dev/api/submit" })).toContain(
      "submission"
    );
    expect(classifyEndpoint({ method: "GET", url: "wss://ctf.firecrawl.dev/socket" })).toContain(
      "websocket"
    );
    expect(classifyEndpoint({ method: "GET", url: "https://ctf.firecrawl.dev/assets/index.js" })).toContain(
      "bundle"
    );
    expect(classifyEndpoint({ method: "POST", url: "https://ctf.firecrawl.dev/api/session" })).toEqual([
      "problem-feed",
      "run-control"
    ]);
    expect(classifyEndpoint({ method: "POST", url: "https://ctf.firecrawl.dev/api/session/replay" })).toEqual([
      "telemetry"
    ]);
    expect(classifyEndpoint({ method: "POST", url: "https://ctf.firecrawl.dev/api/level-1/finish" })).toContain(
      "submission"
    );
  });
});

describe("buildEndpointSummaries", () => {
  it("aggregates network records into stable endpoint summaries", () => {
    const records: NetworkRecord[] = [
      {
        id: "1",
        type: "http",
        method: "GET",
        url: "https://ctf.firecrawl.dev/api/problems?run=1",
        resourceType: "xhr",
        requestHeaders: {},
        status: 200,
        responseHeaders: { "content-type": "application/json" },
        startedAt: "2026-05-19T00:00:00.000Z"
      },
      {
        id: "2",
        type: "http",
        method: "GET",
        url: "https://ctf.firecrawl.dev/api/problems?run=2",
        resourceType: "xhr",
        requestHeaders: {},
        status: 500,
        responseHeaders: { "content-type": "application/json" },
        startedAt: "2026-05-19T00:00:01.000Z"
      },
      {
        id: "3",
        type: "http",
        method: "POST",
        url: "https://ctf.firecrawl.dev/api/submit",
        resourceType: "fetch",
        requestHeaders: { "content-type": "application/json" },
        requestPostData: "{\"answer\":\"42\"}",
        status: 204,
        responseHeaders: {},
        startedAt: "2026-05-19T00:00:02.000Z"
      }
    ];

    const summaries = buildEndpointSummaries(records);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      key: "GET https://ctf.firecrawl.dev/api/problems",
      count: 2,
      methods: ["GET"],
      statuses: [200, 500],
      resourceTypes: ["xhr"],
      tags: ["problem-feed"]
    });
    expect(summaries[1]).toMatchObject({
      key: "POST https://ctf.firecrawl.dev/api/submit",
      count: 1,
      methods: ["POST"],
      statuses: [204],
      resourceTypes: ["fetch"],
      tags: ["submission"]
    });
  });
});

describe("Comet cookie helpers", () => {
  it("converts Chromium cookie timestamps to Unix seconds and preserves session cookies", () => {
    expect(chromeTimeToUnixSeconds(0)).toBe(-1);
    expect(chromeTimeToUnixSeconds(11644473600000000)).toBe(0);
    expect(chromeTimeToUnixSeconds(11644473600000000 + 1_500_000)).toBe(1.5);
  });

  it("maps Chromium sameSite integers to Playwright values", () => {
    expect(mapChromeSameSite(-1)).toBe("None");
    expect(mapChromeSameSite(0)).toBe("None");
    expect(mapChromeSameSite(1)).toBe("Lax");
    expect(mapChromeSameSite(2)).toBe("Strict");
  });
});

import { describe, expect, it } from "vitest";

import { extractLevel3UiSessionFromNetworkRecords } from "../src/level3/ui-session.js";
import type { NetworkRecord } from "../src/recon/types.js";

describe("extractLevel3UiSessionFromNetworkRecords", () => {
  it("returns the latest browser-started Level 3 session payload", () => {
    const records: NetworkRecord[] = [
      {
        id: "1",
        type: "http",
        method: "POST",
        url: "https://ctf.firecrawl.dev/api/session",
        resourceType: "fetch",
        requestHeaders: {},
        startedAt: "now",
        responseBodyPreview: JSON.stringify({ level: 1, problems: [] })
      },
      {
        id: "2",
        type: "http",
        method: "POST",
        url: "https://ctf.firecrawl.dev/api/session",
        resourceType: "fetch",
        requestHeaders: {},
        startedAt: "now",
        responseBodyPreview: JSON.stringify({
          sessionId: "sess",
          level: 3,
          expiresAt: 123,
          problems: [
            {
              id: "challenge",
              taskName: "Policy",
              language: "C",
              spec: "spec",
              starterCode: "starter",
              checks: [{ id: "check", name: "Behavior Bucket 1" }]
            }
          ]
        })
      }
    ];

    expect(extractLevel3UiSessionFromNetworkRecords(records)?.sessionId).toBe("sess");
  });
});

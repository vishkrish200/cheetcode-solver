import { describe, expect, it } from "vitest";

import {
  buildCookieHeader,
  buildFingerprintHints,
  buildLevel1Submissions,
  buildReplaySnapshot,
  buildReplaySummary,
  resolveGithubIdentity
} from "../src/level1/api.js";

describe("resolveGithubIdentity", () => {
  it("uses the authenticated isolated account instead of the legacy account", () => {
    expect(resolveGithubIdentity(undefined)).toBe("trimaxeng2");
    expect(resolveGithubIdentity(" trimaxeng2 ")).toBe("trimaxeng2");
    expect(() => resolveGithubIdentity("trimax-eng")).toThrow(/legacy/);
  });
});

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

describe("current session replay lifecycle", () => {
  const session = {
    sessionId: "session-1",
    startedAt: 1000,
    expiresAt: 61000,
    level: 1,
    problems: [
      {
        id: "problem-1",
        title: "Example",
        tier: "easy",
        description: "",
        signature: "function example(value)",
        starterCode: "function example(value) {}",
        testCases: []
      }
    ]
  };
  const solved = [{
    problemId: "problem-1",
    title: "Example",
    signature: "function example(value)",
    known: true,
    source: "catalog" as const,
    code: "function example(value) { return value; }"
  }];

  it("matches the current client summary shape", () => {
    const summary = buildReplaySummary(session, "trimaxeng2", buildFingerprintHints("fp-1", 1234), solved);

    expect(summary).toMatchObject({
      github: "trimaxeng2",
      screen: "playing",
      level: 1,
      expiresAt: 61000,
      totalProblems: 1,
      draftCount: 1,
      solvedLocal: 1,
      isSubmitting: false,
      isRestoringSession: false,
      submitError: null,
      submittedLead: false
    });
    expect(summary.fingerprint.fingerprintId).toBe("fp-1");
  });

  it("snapshots problem metadata, code drafts, and local pass state", () => {
    expect(buildReplaySnapshot(session.problems, solved)).toEqual({
      type: "level1",
      problems: [{ id: "problem-1", title: "Example", tier: "easy" }],
      codes: { "problem-1": "function example(value) { return value; }" },
      localPass: { "problem-1": true }
    });
  });
});

describe("Level 1 submission payload", () => {
  it("preserves the exact problemId/code pairs used for validation and finish", () => {
    const solved = [
      { problemId: "p1", title: "One", signature: "", known: true, code: "function one() {}" },
      { problemId: "p2", title: "Two", signature: "", known: false, code: "function two() {}" }
    ];

    expect(buildLevel1Submissions(solved)).toEqual([
      { problemId: "p1", code: "function one() {}" },
      { problemId: "p2", code: "function two() {}" }
    ]);
  });
});

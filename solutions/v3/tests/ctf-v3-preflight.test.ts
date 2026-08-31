import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertExpectedV3Contract, parsePreflightArgs, parsePublicContract, runPreflightCli } from "../src/ctf-v3-preflight.js";
import { TARGET_URL } from "../src/recon/capture.js";

const html = '<title>CheetCode v3</title><meta name="description" content="3 levels. 60 problems. 240 seconds. Good luck.">';
const bundle = [
  "const PROBLEMS_PER_SESSION=25,LEVEL2_TOTAL=10,LEVEL3_TOTAL=25,LEVEL2_DURATION_SECONDS=60,LEVEL3_DURATION_SECONDS=120,TOTAL_DURATION_SECONDS=240;",
  'fetch("/api/session");fetch("/api/session/restore");fetch("/api/session/replay");',
  'fetch("/api/level-1/validate");fetch("/api/level-1/finish");',
  'fetch("/api/level-2/preview");fetch("/api/level-3/preview");'
].join("\n");

describe("v3 public contract preflight", () => {
  it("extracts and validates the expected deployed contract", () => {
    const contract = parsePublicContract(html, bundle);
    expect(() => assertExpectedV3Contract(contract)).not.toThrow();
    expect(contract.constants).toEqual({
      problemsPerSession: 25,
      level2Total: 10,
      level3Total: 25,
      level2DurationSeconds: 60,
      level3DurationSeconds: 120,
      totalDurationSeconds: 240
    });
  });

  it("fails closed when the deployed challenge changes", () => {
    const contract = parsePublicContract(html, bundle.replace("LEVEL3_TOTAL=25", "LEVEL3_TOTAL=24"));
    expect(() => assertExpectedV3Contract(contract)).toThrow(/level3Total/);
  });
});

describe("v3 preflight CLI", () => {
  const io = { log: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in preflight test."); }));
    io.log.mockClear();
    io.error.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the configured default and honors an optional positional URL", () => {
    expect(parsePreflightArgs([])).toEqual({ url: new URL(TARGET_URL).href });
    expect(parsePreflightArgs(["https://example.test/challenge/"])).toEqual({ url: "https://example.test/challenge/" });
    expect(parsePreflightArgs(["http://localhost:3000"])).toEqual({ url: "http://localhost:3000/" });
  });

  it.each(["--help", "-h"])("supports %s without any network request", async (help) => {
    expect(await runPreflightCli([help], io)).toBe(0);
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("unauthenticated, read-only"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["--unknown"], ["not-a-url"], [""], ["file:///tmp/page.html"], ["javascript:alert(1)"],
    ["https://user:password@example.test/"], ["https://a.test", "https://b.test"], ["--help", "ignored"]
  ])("rejects malformed arguments without fetching: %j", async (...argv) => {
    expect(await runPreflightCli(argv, io)).toBe(1);
    expect(io.error).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches and reports the supplied URL, resolving its script paths", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(`${html}<script src="./game.js"></script>`))
      .mockResolvedValueOnce(new Response(bundle));
    expect(await runPreflightCli(["https://example.test/challenge/"], io)).toBe(0);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.test/challenge/", "https://example.test/challenge/game.js"
    ]);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.credentials === "omit" && options.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.parse(io.log.mock.calls[0]![0])).toMatchObject({ url: "https://example.test/challenge/", contract: { title: "CheetCode v3" } });
  });

  it("treats an unauthenticated shell as blocked without recommending escalation", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(html));
    expect(await runPreflightCli(["https://example.test/"], io)).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("public page shell may omit"));
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("No browser access, cookie import, or live-session escalation was attempted"));
    expect(io.error.mock.calls.flat().join(" ")).not.toMatch(/Comet/);
  });

  it("fails on HTTP errors and changed contracts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect(await runPreflightCli(["https://example.test/"], io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("503"));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(`${html}<script src="/game.js"></script>`))
      .mockResolvedValueOnce(new Response(bundle.replace("LEVEL3_TOTAL=25", "LEVEL3_TOTAL=24")));
    expect(await runPreflightCli(["https://example.test/"], io)).toBe(1);
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("Unexpected level3Total"));
  });
});

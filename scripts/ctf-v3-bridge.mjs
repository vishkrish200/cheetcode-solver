import fs from "node:fs";
import http from "node:http";
import { solveKnownProblem } from "../src/level1/solutions.ts";

const source = fs.readFileSync(new URL("../src/level1/solutions.ts", import.meta.url), "utf8");
const names = [...source.matchAll(/^  ([A-Za-z_$][A-Za-z0-9_$]*): \(\)/gm)].map((match) => match[1]);
const solverMap = Object.fromEntries(names.map((name) => [
  name,
  solveKnownProblem({
    id: name,
    title: name,
    tier: "",
    description: "",
    signature: `function ${name}()`,
    starterCode: `function ${name}() {}`,
    testCases: [],
  }).code,
]));

const bridgeScript = `
(() => {
  const solverMap = ${JSON.stringify(solverMap)};
  const FIRE_FLAG = "🔥{you_found_the_fire}";
  const publish = (value) => document.documentElement.setAttribute("data-ctf-bridge", JSON.stringify(value));
  const originalFetch = window.fetch;
  window.__ctfBridge = {
    solverCount: Object.keys(solverMap).length,
    session: null,
    sessionHeaders: {},
    lastFinish: null,
    async run(options = {}) {
      if (!/trimax-eng/i.test((document.body?.innerText || "") + "\\n" + (document.body?.textContent || ""))) throw new Error("fake-account guard failed");
      const session = this.session;
      if (!session) throw new Error("no captured session");
      const missing = [];
      const submissions = session.problems.map((problem) => {
        const match = problem.signature.match(/function\\s+([A-Za-z_$][\\w$]*)/);
        const name = match?.[1];
        if (!name || !solverMap[name]) missing.push(name || "unknown");
        return { problemId: problem.id, code: solverMap[name] || problem.starterCode };
      });
      if (options.extraSubmission) submissions.push({ problemId: "l1p_extra_probe", code: "function extraProbe() { return 0; }" });
      const headers = {
        "content-type": "application/json",
        ...(this.sessionHeaders["x-client-fingerprint"]
          ? { "x-client-fingerprint": this.sessionHeaders["x-client-fingerprint"] }
          : {})
      };
      if (options.includeHeaderHack) headers["x-firecrawl-hack"] = "true";
      const body = {
        sessionId: session.sessionId,
        github: "trimax-eng",
        timeElapsed: options.timeElapsed ?? Math.max(0, Date.now() - session.startedAt),
        submissions,
      };
      if (options.includeFlag) body.flag = "🔥{you_found_the_fire}";
      const response = await originalFetch("/api/level-1/finish", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      const result = {
        kind: "finish",
        status: response.status,
        missing,
        score: payload.attempt?.score,
        elo: payload.attempt?.elo,
        solved: payload.attempt?.solved,
          timeRemaining: payload.attempt?.timeRemaining,
          exploits: payload.attempt?.exploits,
          landmines: payload.attempt?.landmines,
          options,
        scoreBreakdown: payload.attempt?.scoreBreakdown,
        error: payload.error,
        message: payload.message,
        attempt: payload.attempt,
      };
      this.lastFinish = result;
      publish(result);
      return result;
    },
  };
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]).includes("/api/session") && !String(args[0]).includes("/replay")) {
      response.clone().json().then((session) => {
        window.__ctfBridge.session = session;
        const requestHeaders = args[1]?.headers;
        window.__ctfBridge.sessionHeaders = requestHeaders instanceof Headers
          ? Object.fromEntries(requestHeaders.entries())
          : { ...(requestHeaders || {}) };
        publish({
          kind: "session",
          sessionId: session.sessionId,
          problemCount: session.problems?.length,
          hasFingerprint: Boolean(window.__ctfBridge.sessionHeaders["x-client-fingerprint"]),
          tokens: [...new Set(session.problems.flatMap((problem) => [...(problem.description || "").matchAll(/lm_[a-z0-9]+/gi)].map((match) => match[0])))],
          names: (session.problems || []).map((problem) => problem.signature.match(/function\\s+([A-Za-z_$][\\w$]*)/)?.[1]),
        });
      });
    }
    return response;
  };
  publish({ kind: "ready", solverCount: Object.keys(solverMap).length });
})();
`;

const runScript = `window.__ctfBridge?.run?.().catch((error) => {
  document.documentElement.setAttribute("data-ctf-bridge", JSON.stringify({ kind: "error", message: String(error) }));
});`;

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.url === "/bridge.js") {
    response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    response.end(bridgeScript);
    return;
  }
  if (url.pathname === "/bridge-chunk") {
    const start = Number(url.searchParams.get("start") || 0);
    const size = Number(url.searchParams.get("size") || 16000);
    if (!Number.isInteger(start) || !Number.isInteger(size) || start < 0 || size < 1 || size > 20000) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("invalid chunk range");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(bridgeScript.slice(start, start + size));
    return;
  }
  if (request.url === "/run.js") {
    response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    response.end(runScript);
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

const port = Number(process.env.CTF_BRIDGE_PORT || 43127);
server.listen(port, "127.0.0.1", () => {
  console.log(`CTF bridge listening on http://127.0.0.1:${port}`);
});

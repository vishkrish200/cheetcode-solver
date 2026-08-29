// Offline audit: does the code we validated match the code we submitted?
// Consumes a captured trace (playwright network.json or a DevTools .har) and
// cross-checks /api/level-1/validate against /api/level-1/finish. No network.
//
// Usage: npm run level1:audit -- <trace.json|trace.har>
import { promises as fs } from "node:fs";

interface Call {
  url: string;
  body: string;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("usage: npm run level1:audit -- <network.json|trace.har>");
  const calls = extractCalls(JSON.parse(await fs.readFile(file, "utf8")));

  const sessions = calls.filter((c) => c.url.includes("/api/session") && !c.url.includes("replay"));
  const validates = calls.filter((c) => c.url.includes("/api/level-1/validate")).map((c) => JSON.parse(c.body));
  const finishes = calls.filter((c) => c.url.includes("/api/level-1/finish")).map((c) => JSON.parse(c.body));

  if (finishes.length !== 1) console.warn(`WARN: ${finishes.length} finish calls in trace`);
  const finish = finishes.at(-1);
  if (!finish) throw new Error("no /api/level-1/finish request in trace");

  const sessionIds = new Set([...validates, ...finishes].map((b) => b.sessionId));
  console.log(`sessions created: ${sessions.length}, distinct sessionId in validate+finish: ${[...sessionIds].join(", ")}`);
  if (sessionIds.size > 1) console.log("FAIL: validate and finish used different sessions");

  const validated = new Map<string, string>();
  for (const v of validates) validated.set(v.problemId, v.code ?? "");

  const submissions: Array<{ problemId: string; code: string }> = finish.submissions ?? [];
  const empty = submissions.filter((s) => !s.code?.trim());
  const unvalidated = submissions.filter((s) => !validated.has(s.problemId));
  const drifted = submissions.filter((s) => validated.has(s.problemId) && validated.get(s.problemId) !== s.code);

  console.log(`github=${finish.github} timeElapsed=${finish.timeElapsed} submissions=${submissions.length} validated=${validated.size}`);
  console.log(`empty code: ${empty.length}`);
  console.log(`submitted but never validated: ${unvalidated.length}`);
  console.log(`code differs from what was validated: ${drifted.length}`);
  for (const s of [...empty, ...unvalidated, ...drifted].slice(0, 5)) {
    console.log(`- ${s.problemId}: submitted ${JSON.stringify((s.code ?? "").slice(0, 60))}, validated ${JSON.stringify((validated.get(s.problemId) ?? "<none>").slice(0, 60))}`);
  }

  const clean = empty.length === 0 && unvalidated.length === 0 && drifted.length === 0 && sessionIds.size === 1;
  console.log(clean ? "PASS: finish body is byte-identical to what the server said passed" : "FAIL: finish body is not what was validated");
}

// ponytail: two trace shapes, both flat. Add more when a third capture tool shows up.
function extractCalls(trace: unknown): Call[] {
  const entries = (trace as { log?: { entries?: unknown[] } }).log?.entries;
  if (Array.isArray(entries)) {
    return entries
      .map((e) => e as { request?: { url?: string; postData?: { text?: string } } })
      .filter((e) => e.request?.postData?.text)
      .map((e) => ({ url: e.request!.url ?? "", body: e.request!.postData!.text! }));
  }
  if (Array.isArray(trace)) {
    return (trace as Array<{ url?: string; requestPostData?: string }>)
      .filter((e) => e.requestPostData)
      .map((e) => ({ url: e.url ?? "", body: e.requestPostData! }));
  }
  throw new Error("unrecognized trace format: expected a HAR or a playwright network.json array");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

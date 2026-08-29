import { promises as fs } from "node:fs";

interface Call {
  url: string;
  body: string;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath) throw new Error("usage: npm run level1:fingerprint -- <network.json|trace.har> [output.json]");

  const trace = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const sessionCall = extractCalls(trace).find((call) => call.url.includes("/api/session") && !call.url.includes("/replay"));
  if (!sessionCall) throw new Error("no /api/session request found in trace");

  const body = JSON.parse(sessionCall.body) as { fingerprintHints?: unknown };
  if (!body.fingerprintHints || typeof body.fingerprintHints !== "object") {
    throw new Error("/api/session request has no fingerprintHints object");
  }
  const hints = body.fingerprintHints as { fingerprintId?: unknown };
  if (typeof hints.fingerprintId !== "string" || !hints.fingerprintId) {
    throw new Error("fingerprintHints has no usable fingerprintId");
  }

  const serialized = `${JSON.stringify(body.fingerprintHints, null, 2)}\n`;
  if (outputPath) {
    await fs.writeFile(outputPath, serialized);
    console.log(`Fingerprint hints written to ${outputPath}`);
  } else {
    process.stdout.write(serialized);
  }
}

function extractCalls(trace: unknown): Call[] {
  const entries = (trace as { log?: { entries?: unknown[] } }).log?.entries;
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => entry as { request?: { url?: string; postData?: { text?: string } } })
      .filter((entry) => entry.request?.postData?.text)
      .map((entry) => ({ url: entry.request!.url ?? "", body: entry.request!.postData!.text! }));
  }
  if (Array.isArray(trace)) {
    return (trace as Array<{ url?: string; requestPostData?: string }>)
      .filter((entry) => entry.requestPostData)
      .map((entry) => ({ url: entry.url ?? "", body: entry.requestPostData! }));
  }
  throw new Error("unrecognized trace format: expected a HAR or a playwright network.json array");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

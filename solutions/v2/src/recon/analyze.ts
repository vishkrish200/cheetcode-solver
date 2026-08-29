import { promises as fs } from "node:fs";
import path from "node:path";

import type { EndpointSummary, NetworkRecord } from "./types.js";

export interface EndpointLike {
  method: string;
  url: string;
  resourceType?: string;
}

export function routeKeyFromUrl(method: string, rawUrl: string): string {
  const normalizedMethod = method.toUpperCase();

  try {
    const parsed = new URL(rawUrl);
    return `${normalizedMethod} ${parsed.origin}${parsed.pathname}`;
  } catch {
    return `${normalizedMethod} ${rawUrl.split("?")[0] ?? rawUrl}`;
  }
}

export function classifyEndpoint(endpoint: EndpointLike): string[] {
  const tags: string[] = [];
  const method = endpoint.method.toUpperCase();
  const url = endpoint.url.toLowerCase();
  const pathname = parsePathname(endpoint.url).toLowerCase();
  const resourceType = endpoint.resourceType?.toLowerCase() ?? "";
  const isWriteMethod = ["POST", "PUT", "PATCH"].includes(method);

  if (url.startsWith("ws://") || url.startsWith("wss://") || resourceType === "websocket") {
    tags.push("websocket");
  }

  if (/convex\.cloud\/api\/.*\/sync/.test(url)) {
    tags.push("realtime-sync");
  }

  if (/\.(?:js|mjs|css)(?:\?|$)/i.test(endpoint.url) || resourceType === "script" || resourceType === "stylesheet") {
    tags.push("bundle");
  }

  if (/graphql/.test(pathname)) {
    tags.push("graphql");
  }

  if (/\/api\/session\/replay$/.test(pathname)) {
    tags.push("telemetry");
  } else if (/\/api\/session$/.test(pathname) && method === "POST") {
    tags.push("problem-feed", "run-control");
  } else if (/(oauth|auth|session|callback|github)/.test(pathname)) {
    tags.push("auth-session");
  }

  if (/(problem|question|challenge|task)/.test(pathname)) {
    tags.push("problem-feed");
  }

  if (/(orchestrate|start|run|attempt)/.test(pathname)) {
    tags.push("run-control");
  }

  if (isWriteMethod && /(finish|submit|answer|solve|response|validate)/.test(pathname)) {
    tags.push("submission");
  }

  return tags.length > 0 ? tags : ["unclassified"];
}

function parsePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

export function buildEndpointSummaries(records: NetworkRecord[]): EndpointSummary[] {
  const byKey = new Map<string, EndpointSummary>();

  for (const record of records) {
    const key = routeKeyFromUrl(record.method, record.url);
    const existing =
      byKey.get(key) ??
      ({
        key,
        count: 0,
        methods: [],
        statuses: [],
        resourceTypes: [],
        contentTypes: [],
        tags: [],
        sampleUrls: []
      } satisfies EndpointSummary);

    existing.count += 1;
    addUnique(existing.methods, record.method.toUpperCase());
    if (typeof record.status === "number") addUnique(existing.statuses, record.status);
    if (record.resourceType) addUnique(existing.resourceTypes, record.resourceType);

    const contentType = findHeader(record.responseHeaders, "content-type");
    if (contentType) addUnique(existing.contentTypes, contentType.split(";")[0]?.trim() ?? contentType);

    for (const tag of classifyEndpoint(record)) addUnique(existing.tags, tag);
    if (existing.sampleUrls.length < 3) addUnique(existing.sampleUrls, record.url);
    existing.sampleRequestPostData ??= record.requestPostData;
    existing.sampleResponseBodyPreview ??= record.responseBodyPreview;

    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).map((summary) => ({
    ...summary,
    statuses: summary.statuses.sort((a, b) => a - b),
    methods: summary.methods.sort(),
    resourceTypes: summary.resourceTypes.sort(),
    contentTypes: summary.contentTypes.sort(),
    tags: tagSort(summary.tags)
  }));
}

export async function analyzeRun(runDir: string): Promise<EndpointSummary[]> {
  const networkPath = path.join(runDir, "network.json");
  const raw = await fs.readFile(networkPath, "utf8");
  const records = JSON.parse(raw) as NetworkRecord[];
  const summaries = buildEndpointSummaries(records);

  await fs.writeFile(path.join(runDir, "endpoint-summary.json"), `${JSON.stringify(summaries, null, 2)}\n`);
  await fs.writeFile(path.join(runDir, "endpoint-summary.md"), renderEndpointSummaryMarkdown(runDir, summaries));

  return summaries;
}

export function renderEndpointSummaryMarkdown(runDir: string, summaries: EndpointSummary[]): string {
  const lines = [
    `# Endpoint Summary`,
    ``,
    `Run: \`${runDir}\``,
    ``,
    `| Count | Statuses | Tags | Endpoint | Resource Types |`,
    `|---:|---|---|---|---|`
  ];

  for (const summary of summaries) {
    lines.push(
      `| ${summary.count} | ${summary.statuses.join(", ") || "-"} | ${summary.tags.join(", ")} | \`${summary.key}\` | ${
        summary.resourceTypes.join(", ") || "-"
      } |`
    );
  }

  lines.push("");
  lines.push("## Samples");
  lines.push("");

  for (const summary of summaries) {
    lines.push(`### ${summary.key}`);
    lines.push("");
    lines.push(`Tags: ${summary.tags.join(", ")}`);
    lines.push(`Sample URLs:`);
    for (const url of summary.sampleUrls) lines.push(`- ${url}`);
    if (summary.sampleRequestPostData) {
      lines.push("");
      lines.push("Sample request body:");
      lines.push("```");
      lines.push(summary.sampleRequestPostData.slice(0, 1200));
      lines.push("```");
    }
    if (summary.sampleResponseBodyPreview) {
      lines.push("");
      lines.push("Sample response body:");
      lines.push("```");
      lines.push(summary.sampleResponseBodyPreview.slice(0, 1200));
      lines.push("```");
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function addUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function findHeader(headers: Record<string, string> | undefined, wantedName: string): string | undefined {
  if (!headers) return undefined;
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === wantedName.toLowerCase());
  return match?.[1];
}

function tagSort(tags: string[]): string[] {
  const priority = [
    "problem-feed",
    "submission",
    "run-control",
    "telemetry",
    "websocket",
    "realtime-sync",
    "graphql",
    "auth-session",
    "bundle",
    "unclassified"
  ];
  return [...tags].sort((a, b) => {
    const left = priority.indexOf(a);
    const right = priority.indexOf(b);
    return (left === -1 ? priority.length : left) - (right === -1 ? priority.length : right) || a.localeCompare(b);
  });
}

// Mint a fresh, server-signed ctf_fp by re-registering our fingerprint hints.
//
// Why this exists: ctf_fp is a v2.<payload>.<hmac> token the SERVER signs at
// /api/session from the fingerprintHints we POST. The client never forges it.
// Our runners re-send the STALE ctf_fp cookie every request and ignore the
// Set-Cookie response, so the worn srvfp/cluster never rotates.
//
// The anti-abuse key is `stableDeviceClusterKey`, derived server-side as
//   hash({platform,timezone,language,screen:"WxH",dpr,cpu,memory,touch})
// -> fingerprintId is NOT an input. Only changing a device signal in the hints
// (screen/cpu/memory/...) moves the cluster. So we POST hints WITHOUT the stale
// ctf_fp, read the freshly signed cookie, and write a new storage-state.
//
// Usage:
//   CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/fingerprint-hints-fresh-*.json \
//   [AUTH_STORAGE_STATE_PATH=recon-output/storage-state.json] \
//   [OUT=recon-output/storage-state.fresh.json] \
//   [CHEETCODE_USER_AGENT=...] [CHEETCODE_GITHUB_PAT=...] \
//   tsx scripts/mint-fresh-ctf-fp.ts

import { promises as fs } from "node:fs";
import path from "node:path";

import { readFingerprintHintsFromEnv, writeJson } from "../src/level1/api.js";
import { TARGET_URL, STORAGE_STATE_PATH } from "../src/recon/capture.js";

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}
interface StorageState {
  cookies: StorageCookie[];
  origins: unknown[];
}

function decodeCtfFp(value: string): Record<string, unknown> | null {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function summarize(label: string, token: string | undefined): void {
  if (!token) {
    console.log(`${label}: (none)`);
    return;
  }
  const p = decodeCtfFp(token) as any;
  const h = p?.hashes ?? {};
  console.log(
    `${label}: srvfp=${p?.trustedFingerprint} clusterKey=${h.stableDeviceClusterKey} ` +
      `fpIdHash=${h.fingerprintIdHash} renderHash=${h.renderingHash}`
  );
}

// self-check: decoder must recover a known srvfp from a real captured token
{
  const sample =
    "v2.eyJ0b2tlblZlcnNpb24iOiJ2MiIsInRydXN0ZWRGaW5nZXJwcmludCI6InNydmZwLTk3OTliOWI0MDI5MTBmNjEifQ.sig";
  const decoded = decodeCtfFp(sample) as any;
  if (decoded?.trustedFingerprint !== "srvfp-9799b9b402910f61") {
    throw new Error("decodeCtfFp self-check failed");
  }
}

const hints = await readFingerprintHintsFromEnv();
if (!hints) {
  throw new Error("Set CHEETCODE_FINGERPRINT_HINTS_PATH to the fresh fingerprint-hints json.");
}

const inPath = STORAGE_STATE_PATH;
const storage = JSON.parse(await fs.readFile(inPath, "utf8")) as StorageState;
const host = new URL(TARGET_URL).hostname;

const cookiesForHost = storage.cookies.filter((c) => {
  const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
  return host === d || host.endsWith(`.${d}`);
});
const oldCtfFp = cookiesForHost.find((c) => c.name === "ctf_fp")?.value;

// Strip ctf_fp so the server is forced to mint a new one from our hints.
const cookieHeader = cookiesForHost
  .filter((c) => c.name !== "ctf_fp")
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");
if (!cookieHeader) throw new Error(`No non-ctf_fp cookies for ${host} in ${inPath} (need the auth cookie).`);

const headers: Record<string, string> = {
  "content-type": "application/json",
  referer: TARGET_URL,
  cookie: cookieHeader,
  "x-client-fingerprint": hints.fingerprintId
};
if (process.env.CHEETCODE_USER_AGENT) headers["user-agent"] = process.env.CHEETCODE_USER_AGENT;
if (process.env.CHEETCODE_GITHUB_PAT) headers["authorization"] = `Bearer ${process.env.CHEETCODE_GITHUB_PAT}`;

console.log(`POST ${new URL("/api/session", TARGET_URL).href}  (ctf_fp stripped, fingerprintId=${hints.fingerprintId})`);
const res = await fetch(new URL("/api/session", TARGET_URL), {
  method: "POST",
  headers,
  body: JSON.stringify({ level: 1, isDev: false, fingerprintHints: hints })
});
const body = await res.text();
console.log(`status: ${res.status}`);
if (!res.ok) throw new Error(`/api/session failed: ${res.status} ${body.slice(0, 500)}`);

const setCookies = res.headers.getSetCookie?.() ?? [];
const minted = setCookies.map((sc) => sc.match(/^ctf_fp=([^;]+)/)?.[1]).find(Boolean);
if (!minted) {
  console.log("Set-Cookie headers:", setCookies);
  throw new Error("Server did not Set-Cookie a new ctf_fp. Inspect Set-Cookie above / response body.");
}

console.log("\n--- fingerprint rotation ---");
summarize("old", oldCtfFp);
summarize("new", minted);
const oldKey = (decodeCtfFp(oldCtfFp ?? "") as any)?.hashes?.stableDeviceClusterKey;
const newKey = (decodeCtfFp(minted) as any)?.hashes?.stableDeviceClusterKey;
console.log(
  oldKey && newKey && oldKey === newKey
    ? "\n⚠  clusterKey UNCHANGED — hints did not vary a device signal (screen/cpu/memory/…); still same cluster."
    : "\n✓ clusterKey CHANGED — landed in a new device cluster."
);

// Write a new storage-state with the minted ctf_fp swapped in.
const outPath = process.env.OUT
  ? path.resolve(process.env.OUT)
  : path.resolve("recon-output", `storage-state.fresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const template = cookiesForHost.find((c) => c.name === "ctf_fp");
const next: StorageState = {
  ...storage,
  cookies: [
    ...storage.cookies.filter((c) => !(c.name === "ctf_fp" && cookiesForHost.includes(c))),
    {
      name: "ctf_fp",
      value: minted,
      domain: template?.domain ?? `.${host}`,
      path: template?.path ?? "/",
      expires: template?.expires ?? -1,
      httpOnly: template?.httpOnly ?? false,
      secure: template?.secure ?? true,
      sameSite: template?.sameSite ?? "Lax"
    }
  ]
};
await writeJson(outPath, next);
console.log(`\nwrote ${outPath}`);
console.log(`use it:  AUTH_STORAGE_STATE_PATH=${outPath} <your runner>`);

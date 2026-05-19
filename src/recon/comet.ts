import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { OUTPUT_ROOT, STORAGE_STATE_PATH, createRunDir } from "./capture.js";

type CookieSameSite = "Strict" | "Lax" | "None";

interface ChromeCookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value_hex: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
}

const CHROME_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000;
const COMET_SUPPORT_DIR = path.join(os.homedir(), "Library", "Application Support", "Comet");
const COMET_COOKIE_DB = path.join(COMET_SUPPORT_DIR, "Default", "Cookies");
const COMET_KEYCHAIN_SERVICE = "Comet Safe Storage";
const COOKIE_FILTER_SQL = "(host_key like '%firecrawl.dev' or host_key like '%github.com')";

export function chromeTimeToUnixSeconds(chromeTimeMicros: number): number {
  if (chromeTimeMicros === 0) return -1;
  return (chromeTimeMicros - CHROME_EPOCH_OFFSET_MICROS) / 1_000_000;
}

export function mapChromeSameSite(value: number): CookieSameSite {
  if (value === 1) return "Lax";
  if (value === 2) return "Strict";
  return "None";
}

export async function exportCometStorageState(): Promise<string> {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  const runDir = await createRunDir("auth-comet");
  const tempCookieDb = path.join(runDir, "comet-cookies.sqlite");

  await fs.copyFile(COMET_COOKIE_DB, tempCookieDb);

  const passphrase = getCometSafeStoragePassphrase();
  const rows = readCometCookieRows(tempCookieDb);
  const cookies = rows
    .map((row) => chromeCookieToPlaywrightCookie(row, passphrase))
    .filter((cookie): cookie is PlaywrightCookie => cookie !== undefined);

  if (cookies.length === 0) {
    throw new Error("No importable Firecrawl/GitHub cookies found in the Comet profile.");
  }

  await fs.writeFile(
    STORAGE_STATE_PATH,
    `${JSON.stringify(
      {
        cookies,
        origins: []
      },
      null,
      2
    )}\n`
  );

  await fs.writeFile(
    path.join(runDir, "metadata.json"),
    `${JSON.stringify(
      {
        command: "auth:comet",
        cometCookieDb: COMET_COOKIE_DB,
        storageStatePath: STORAGE_STATE_PATH,
        exportedCookieCount: cookies.length,
        exportedCookies: cookies.map((cookie) => ({
          domain: cookie.domain,
          name: cookie.name,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expires: cookie.expires,
          sameSite: cookie.sameSite
        }))
      },
      null,
      2
    )}\n`
  );

  return runDir;
}

function readCometCookieRows(cookieDbPath: string): ChromeCookieRow[] {
  const query = `
    select
      host_key,
      name,
      value,
      hex(encrypted_value) as encrypted_value_hex,
      path,
      expires_utc,
      is_secure,
      is_httponly,
      samesite
    from cookies
    where ${COOKIE_FILTER_SQL}
    order by host_key, name
  `;

  const output = execFileSync("sqlite3", ["-json", cookieDbPath, query], { encoding: "utf8" });
  return JSON.parse(output || "[]") as ChromeCookieRow[];
}

function chromeCookieToPlaywrightCookie(row: ChromeCookieRow, passphrase: string): PlaywrightCookie | undefined {
  const value = row.value || decryptChromeCookieValue(row.encrypted_value_hex, row.host_key, passphrase);
  if (!value) return undefined;

  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || "/",
    expires: chromeTimeToUnixSeconds(row.expires_utc),
    httpOnly: row.is_httponly === 1,
    secure: row.is_secure === 1,
    sameSite: mapChromeSameSite(row.samesite)
  };
}

function getCometSafeStoragePassphrase(): string {
  return execFileSync("security", ["find-generic-password", "-w", "-s", COMET_KEYCHAIN_SERVICE], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function decryptChromeCookieValue(encryptedHex: string, hostKey: string, passphrase: string): string {
  if (!encryptedHex) return "";

  const encrypted = Buffer.from(encryptedHex, "hex");
  const payload = encrypted.subarray(0, 3).toString("utf8") === "v10" ? encrypted.subarray(3) : encrypted;
  const key = crypto.pbkdf2Sync(passphrase, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  let decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

  const hostDigest = crypto.createHash("sha256").update(hostKey).digest();
  if (decrypted.subarray(0, hostDigest.length).equals(hostDigest)) {
    decrypted = decrypted.subarray(hostDigest.length);
  }

  return decrypted.toString("utf8");
}

import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function hasExecutable(name, searchPath = process.env.PATH ?? "") {
  return searchPath.split(path.delimiter).some((directory) => {
    if (!directory) return false;
    try {
      accessSync(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function isSupportedNode(version) {
  const [major, minor] = version.split(".").map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) && ((major === 22 && minor >= 12) || major >= 24);
}

export function checkEnvironment({ nodeVersion = process.versions.node, executable = hasExecutable, installed = existsSync(path.join(ROOT, "node_modules", "typescript", "package.json")) } = {}) {
  return [
    { name: `Node.js ${nodeVersion}`, required: true, ok: isSupportedNode(nodeVersion), purpose: "Node 22.12+ (22.x) or 24+ required; CI uses Node 22" },
    { name: "npm", required: true, ok: executable("npm"), purpose: "workspace installation and commands" },
    { name: "dependencies", required: true, ok: installed, purpose: "install with npm ci" },
    { name: "cc", required: true, ok: executable("cc"), purpose: "C compilation and local harness tests" },
    { name: "c++", required: true, ok: executable("c++"), purpose: "C++ tests and synthetic rehearsal" },
    { name: "rustc", required: false, ok: executable("rustc"), purpose: "all-language candidate compilation" },
    { name: "gh", required: false, ok: executable("gh"), purpose: "optional Level 2 GitHub source lookup" },
    { name: "gcloud", required: false, ok: executable("gcloud"), purpose: "optional Vertex provider" },
    { name: "codex", required: false, ok: executable("codex"), purpose: "optional Codex CLI provider" }
  ];
}

export function main() {
  const checks = checkEnvironment();
  console.log("CheetCode local environment\n");
  for (const check of checks) {
    const status = check.ok ? "OK" : check.required ? "MISSING" : "OPTIONAL";
    console.log(`${status.padEnd(8)} ${check.name}: ${check.purpose}`);
  }
  console.log("\nChecks availability only; does not execute toolchains, read .env, authenticate, launch a browser, or access the network.");
  console.log("See docs/getting-started.md for setup and scope.");
  if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

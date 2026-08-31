import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDocs, headingAnchors } from "./check-docs.mjs";
import { checkEnvironment, isSupportedNode } from "./doctor.mjs";

test("documentation checker validates local paths and heading fragments", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cheetcode-docs-test-"));
  try {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "README.md"), "# Welcome\n[Guide](docs/guide.md#local-checks)\n[External](https://example.com)\n");
    writeFileSync(path.join(root, "docs", "guide.md"), "# Guide\n## Local checks\n[Back](../README.md)\n");
    assert.deepEqual(checkDocs(root).errors, []);
    writeFileSync(path.join(root, "README.md"), "[Missing](absent.md)\n[Bad anchor](docs/guide.md#missing)\n[Escape](../private.md)\n");
    assert.equal(checkDocs(root).errors.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("documentation checker ignores code examples and duplicate-heading anchors", () => {
  assert.deepEqual([...headingAnchors("# Hello, `world`!\n## Repeated\n## Repeated\n```md\n# Not a heading\n```\n")], ["hello-world", "repeated", "repeated-1"]);
});

test("environment doctor separates required local tools from optional integrations", () => {
  const checks = checkEnvironment({ nodeVersion: "22.12.0", executable: (name) => ["npm", "cc", "c++"].includes(name), installed: true });
  assert.equal(checks.filter((check) => check.required && !check.ok).length, 0);
  assert.equal(checks.find((check) => check.name === "rustc").required, false);
  assert.equal(checkEnvironment({ nodeVersion: "18.0.0", executable: () => false, installed: false }).filter((check) => check.required && !check.ok).length, 5);
});

test("environment doctor matches the supported locked-toolchain Node range", () => {
  for (const version of ["18.20.0", "20.19.0", "21.7.0", "22.0.0", "22.11.0", "23.0.0", "invalid"]) {
    assert.equal(isSupportedNode(version), false, version);
  }
  for (const version of ["22.12.0", "22.20.0", "24.0.0", "25.8.2"]) {
    assert.equal(isSupportedNode(version), true, version);
  }
});

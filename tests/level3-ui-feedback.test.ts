import { describe, expect, it } from "vitest";

import {
  describeLevel3TargetMismatch,
  extractLevel3PrestartAssignment,
  extractLevel3UiFeedbackFromText
} from "../src/level3/ui-feedback.js";

describe("extractLevel3UiFeedbackFromText", () => {
  it("extracts bucket rows from visible page text", () => {
    expect(
      extractLevel3UiFeedbackFromText(`
Run
Submit
Behavior Bucket 1
PASS
Behavior Bucket 2
FAIL
Scale Budget 17
PENDING
`)
    ).toEqual([
      { name: "Behavior Bucket 1", status: "PASS" },
      { name: "Behavior Bucket 2", status: "FAIL" },
      { name: "Scale Budget 17", status: "PENDING" }
    ]);
  });

  it("ignores unrelated prose and normalizes mixed case", () => {
    expect(
      extractLevel3UiFeedbackFromText(`
Level 3: Something
Update Bucket 4
failed
not a bucket
Scale Budget 1
pass
`)
    ).toEqual([
      { name: "Update Bucket 4", status: "FAILED" },
      { name: "Scale Budget 1", status: "PASS" }
    ]);
  });

  it("extracts descriptive Level 3 check labels", () => {
    expect(
      extractLevel3UiFeedbackFromText(`
Reset state semantics
FAIL
ADD overflow flag behavior
FAIL
Assembler mnemonic decode benchmark
PENDING
`)
    ).toEqual([
      { name: "Reset state semantics", status: "FAIL" },
      { name: "ADD overflow flag behavior", status: "FAIL" },
      { name: "Assembler mnemonic decode benchmark", status: "PENDING" }
    ]);
  });

  it("extracts C++ prestart assignments without truncating language to C", () => {
    const text = "Your next Level 3 challenge is Distributed Flag Snapshot Rollout Engine assigned in C++. Confirm.";

    expect(extractLevel3PrestartAssignment(text)).toEqual({
      taskName: "Distributed Flag Snapshot Rollout Engine",
      language: "C++"
    });
    expect(describeLevel3TargetMismatch(text, "Distributed Flag Snapshot Rollout Engine", "C++")).toBeUndefined();
    expect(describeLevel3TargetMismatch(text, "Distributed Flag Snapshot Rollout Engine", "C")).toContain(
      "[C++]"
    );
  });
});

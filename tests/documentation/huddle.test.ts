import { describe, it, expect } from "vitest";
import type { HuddleEntry } from "../../src/types.js";
import {
  formatHuddleComment,
  formatSprintLogEntry,
} from "../../src/documentation/huddle.js";

function makeEntry(overrides: Partial<HuddleEntry> = {}): HuddleEntry {
  return {
    issueNumber: 42,
    issueTitle: "Add login page",
    status: "completed",
    qualityResult: {
      passed: true,
      checks: [
        { name: "tests", passed: true, detail: "All 12 tests pass" },
        { name: "lint", passed: true, detail: "No errors" },
      ],
    },
    duration_ms: 125_000,
    filesChanged: ["src/login.ts", "tests/login.test.ts"],
    timestamp: new Date("2025-01-15T10:30:00Z"),
    ...overrides,
  };
}

describe("formatHuddleComment", () => {
  it("formats a passed huddle comment", () => {
    const result = formatHuddleComment(makeEntry());

    expect(result).toContain("### ✅ Huddle — #42 Add login page");
    expect(result).toContain("**Quality**: PASSED");
    expect(result).toContain("✅ tests: All 12 tests pass");
    expect(result).toContain("✅ lint: No errors");
    expect(result).toContain("`src/login.ts`");
    expect(result).toContain("**Files Changed** (2):");
    expect(result).toContain("2m 5s");
    expect(result).toContain("2025-01-15T10:30:00.000Z");
  });

  it("formats a failed huddle comment", () => {
    const entry = makeEntry({
      status: "failed",
      qualityResult: {
        passed: false,
        checks: [
          { name: "tests", passed: false, detail: "3 failures" },
          { name: "lint", passed: true, detail: "No errors" },
        ],
      },
    });
    const result = formatHuddleComment(entry);

    expect(result).toContain("### ❌ Huddle");
    expect(result).toContain("**Quality**: FAILED");
    expect(result).toContain("❌ tests: 3 failures");
    expect(result).toContain("✅ lint: No errors");
  });
});

describe("formatSprintLogEntry", () => {
  it("formats a sprint log entry for a completed issue", () => {
    const result = formatSprintLogEntry(makeEntry());

    expect(result).toContain("### ✅ #42 — Add login page");
    expect(result).toContain("- **Status**: completed");
    expect(result).toContain("- **Duration**: 2m 5s");
    expect(result).toContain("- **Quality**: PASSED");
    expect(result).toContain("- **Files changed**: 2");
  });

  it("formats a sprint log entry for a failed issue", () => {
    const entry = makeEntry({
      status: "failed",
      qualityResult: {
        passed: false,
        checks: [
          { name: "types", passed: false, detail: "5 type errors" },
        ],
      },
    });
    const result = formatSprintLogEntry(entry);

    expect(result).toContain("### ❌ #42");
    expect(result).toContain("- **Status**: failed");
    expect(result).toContain("- **Quality**: FAILED");
    expect(result).toContain("❌ types: 5 type errors");
  });
});

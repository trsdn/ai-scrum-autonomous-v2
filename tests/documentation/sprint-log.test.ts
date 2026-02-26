import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSprintLog,
  appendToSprintLog,
  readSprintLog,
} from "../../src/documentation/sprint-log.js";

describe("sprint-log", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a sprint log file with correct template", () => {
    const filePath = createSprintLog(3, "Ship auth module", 5, tmpDir);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Sprint 3 Log");
    expect(content).toContain("**Goal**: Ship auth module");
    expect(content).toContain("**Planned**: 5 issues");
    expect(content).toContain("## Huddles");
  });

  it("appends entries to an existing sprint log", () => {
    createSprintLog(1, "Test goal", 2, tmpDir);
    appendToSprintLog(1, "### ✅ #10 — Fix bug", tmpDir);
    appendToSprintLog(1, "### ❌ #11 — Add feature", tmpDir);

    const content = readSprintLog(1, tmpDir);
    expect(content).toContain("### ✅ #10 — Fix bug");
    expect(content).toContain("### ❌ #11 — Add feature");
  });

  it("reads back sprint log content", () => {
    createSprintLog(7, "Performance sprint", 3, tmpDir);
    const content = readSprintLog(7, tmpDir);

    expect(content).toContain("Sprint 7 Log");
    expect(content).toContain("Performance sprint");
  });

  it("throws when reading a non-existent sprint log", () => {
    expect(() => readSprintLog(999, tmpDir)).toThrow();
  });
});

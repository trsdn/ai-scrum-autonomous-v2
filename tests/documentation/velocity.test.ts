import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import {
  readVelocity,
  appendVelocity,
  type VelocityEntry,
} from "../../src/documentation/velocity.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const entry: VelocityEntry = {
  sprint: 1,
  date: "2025-01-01",
  goal: "MVP",
  planned: 5,
  done: 4,
  carry: 1,
  hours: 3,
  issuesPerHr: 1.3,
  notes: "Good sprint",
};

describe("velocity", () => {
  it("readVelocity returns empty array when file does not exist", () => {
    const result = readVelocity(path.join(tmpDir, "nonexistent.md"));
    expect(result).toEqual([]);
  });

  it("appendVelocity creates file with header when it does not exist", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    appendVelocity(entry, filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Velocity Tracker");
  });

  it("appendVelocity appends row to existing file", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    appendVelocity(entry, filePath);
    appendVelocity({ ...entry, sprint: 2 }, filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const dataRows = content
      .split("\n")
      .filter((l) => l.startsWith("| "))
      .slice(1); // skip header (separator filtered out by startsWith)
    expect(dataRows).toHaveLength(2);
  });

  it("readVelocity parses markdown table rows", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    const content = [
      "# Velocity Tracker",
      "",
      "| Sprint | Date | Goal | Planned | Done | Carry | Hours | Issues/Hr | Notes |",
      "|--------|------|------|---------|------|-------|-------|-----------|-------|",
      "| 1 | 2025-01-01 | MVP | 5 | 4 | 1 | 3 | 1.3 | Good sprint |",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf-8");

    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sprint: 1,
      date: "2025-01-01",
      goal: "MVP",
      planned: 5,
      done: 4,
      carry: 1,
      hours: 3,
      issuesPerHr: 1.3,
      notes: "Good sprint",
    });
  });

  it("readVelocity round-trips with appendVelocity", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    appendVelocity(entry, filePath);
    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sprint).toBe(entry.sprint);
    expect(entries[0]?.planned).toBe(entry.planned);
    expect(entries[0]?.done).toBe(entry.done);
  });

  it("readVelocity skips separator rows (---|---)", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    const content = [
      "| Sprint | Date | Goal | Planned | Done | Carry | Hours | Issues/Hr | Notes |",
      "|--------|------|------|---------|------|-------|-------|-----------|-------|",
      "| 1 | 2025-01-01 | MVP | 5 | 4 | 1 | 3 | 1.3 | ok |",
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf-8");

    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sprint).toBe(1);
  });

  it("readVelocity skips malformed rows with too few columns", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    const content = [
      "| Sprint | Date | Goal | Planned | Done | Carry | Hours | Issues/Hr | Notes |",
      "| 1 | 2025-01-01 |",
      "| 2 | 2025-02-01 | Sprint 2 | 8 | 7 | 1 | 4 | 1.75 | great |",
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf-8");

    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sprint).toBe(2);
  });

  it("readVelocity handles empty file", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    fs.writeFileSync(filePath, "", "utf-8");
    const entries = readVelocity(filePath);
    expect(entries).toEqual([]);
  });

  it("appendVelocity updates existing sprint entry instead of duplicating", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    // First append
    appendVelocity(entry, filePath);
    // Second append with same sprint number but different data
    appendVelocity(
      { ...entry, done: 5, carry: 0, notes: "Updated notes" },
      filePath,
    );

    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(1); // Should have only 1 entry, not 2
    expect(entries[0]?.sprint).toBe(1);
    expect(entries[0]?.done).toBe(5); // Should have updated value
    expect(entries[0]?.notes).toBe("Updated notes");
  });

  it("appendVelocity handles undefined notes field by defaulting to empty string", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    const entryWithUndefinedNotes = { ...entry, notes: undefined as any };
    appendVelocity(entryWithUndefinedNotes, filePath);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).not.toContain("undefined");

    const entries = readVelocity(filePath);
    expect(entries[0]?.notes).toBe("");
  });

  it("appendVelocity appends new sprint entries without affecting existing different sprints", () => {
    const filePath = path.join(tmpDir, "velocity.md");
    appendVelocity(entry, filePath);
    appendVelocity({ ...entry, sprint: 2, done: 6 }, filePath);

    const entries = readVelocity(filePath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.sprint).toBe(1);
    expect(entries[1]?.sprint).toBe(2);
  });
});

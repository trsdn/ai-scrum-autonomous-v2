import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  checkIssueDrift,
  holisticDriftCheck,
} from "../../src/enforcement/drift-control.js";

describe("checkIssueDrift", () => {
  it("should report no drift when all files are in scope", async () => {
    const result = await checkIssueDrift(
      ["src/a.ts", "src/b.ts"],
      ["src/a.ts", "src/b.ts", "src/c.ts"],
    );

    expect(result.driftDetected).toBe(false);
    expect(result.inScope).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.outOfScope).toEqual([]);
  });

  it("should detect drift when files are out of scope", async () => {
    const result = await checkIssueDrift(
      ["src/a.ts", "src/unexpected.ts"],
      ["src/a.ts", "src/b.ts"],
    );

    expect(result.driftDetected).toBe(true);
    expect(result.inScope).toEqual(["src/a.ts"]);
    expect(result.outOfScope).toEqual(["src/unexpected.ts"]);
  });

  it("should handle empty changed files", async () => {
    const result = await checkIssueDrift([], ["src/a.ts"]);

    expect(result.driftDetected).toBe(false);
    expect(result.inScope).toEqual([]);
    expect(result.outOfScope).toEqual([]);
  });

  it("should handle empty expected files", async () => {
    const result = await checkIssueDrift(["src/a.ts"], []);

    expect(result.driftDetected).toBe(true);
    expect(result.outOfScope).toEqual(["src/a.ts"]);
  });
});

describe("holisticDriftCheck", () => {
  it("should report zero drift when all changes are planned", async () => {
    const report = await holisticDriftCheck(
      ["src/a.ts", "src/b.ts"],
      ["src/a.ts", "src/b.ts"],
    );

    expect(report.totalFilesChanged).toBe(2);
    expect(report.plannedChanges).toBe(2);
    expect(report.unplannedChanges).toEqual([]);
    expect(report.driftPercentage).toBe(0);
  });

  it("should calculate drift percentage correctly", async () => {
    const report = await holisticDriftCheck(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      ["src/a.ts", "src/b.ts"],
    );

    expect(report.totalFilesChanged).toBe(4);
    expect(report.plannedChanges).toBe(2);
    expect(report.unplannedChanges).toEqual(["src/c.ts", "src/d.ts"]);
    expect(report.driftPercentage).toBe(50);
  });

  it("should handle empty inputs", async () => {
    const report = await holisticDriftCheck([], []);

    expect(report.totalFilesChanged).toBe(0);
    expect(report.plannedChanges).toBe(0);
    expect(report.unplannedChanges).toEqual([]);
    expect(report.driftPercentage).toBe(0);
  });

  it("should skip drift check when no expectedFiles defined", async () => {
    const report = await holisticDriftCheck(
      ["src/a.ts", "src/b.ts"],
      [],
    );

    // All changes treated as planned when expectedFiles is empty
    expect(report.driftPercentage).toBe(0);
    expect(report.plannedChanges).toBe(2);
    expect(report.unplannedChanges).toEqual([]);
  });

  it("should handle all files being planned with extras expected", async () => {
    const report = await holisticDriftCheck(
      ["src/a.ts"],
      ["src/a.ts", "src/b.ts", "src/c.ts"],
    );

    expect(report.totalFilesChanged).toBe(1);
    expect(report.plannedChanges).toBe(1);
    expect(report.unplannedChanges).toEqual([]);
    expect(report.driftPercentage).toBe(0);
  });
});

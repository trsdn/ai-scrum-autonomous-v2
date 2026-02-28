import { describe, it, expect } from "vitest";
import {
  calculateSprintMetrics,
  topFailedGates,
  formatDuration,
  percent,
} from "../src/metrics.js";
import type { SprintResult, IssueResult } from "../src/types.js";

function makeIssue(overrides: Partial<IssueResult> = {}): IssueResult {
  return {
    issueNumber: 1,
    status: "completed",
    qualityGatePassed: true,
    qualityDetails: { passed: true, checks: [] },
    branch: "feat/1-test",
    duration_ms: 10000,
    filesChanged: ["src/a.ts"],
    retryCount: 0,
    points: 3,
    ...overrides,
  };
}

function makeResult(issues: IssueResult[]): SprintResult {
  return {
    results: issues,
    sprint: 1,
    parallelizationRatio: 1,
    avgWorktreeLifetime: 0,
    mergeConflicts: 0,
  };
}

describe("calculateSprintMetrics", () => {
  it("calculates metrics for all-passed sprint", () => {
    const result = makeResult([
      makeIssue({ issueNumber: 1, points: 3, duration_ms: 10000 }),
      makeIssue({ issueNumber: 2, points: 5, duration_ms: 20000 }),
    ]);
    const metrics = calculateSprintMetrics(result);
    expect(metrics.planned).toBe(2);
    expect(metrics.completed).toBe(2);
    expect(metrics.failed).toBe(0);
    expect(metrics.pointsPlanned).toBe(8);
    expect(metrics.pointsCompleted).toBe(8);
    expect(metrics.velocity).toBe(8);
    expect(metrics.avgDuration).toBe(15000);
    expect(metrics.firstPassRate).toBe(100);
    expect(metrics.driftIncidents).toBe(0);
  });

  it("calculates metrics for all-failed sprint", () => {
    const result = makeResult([
      makeIssue({ issueNumber: 1, status: "failed", points: 3 }),
      makeIssue({ issueNumber: 2, status: "failed", points: 5 }),
    ]);
    const metrics = calculateSprintMetrics(result);
    expect(metrics.completed).toBe(0);
    expect(metrics.failed).toBe(2);
    expect(metrics.pointsCompleted).toBe(0);
    expect(metrics.velocity).toBe(0);
  });

  it("calculates metrics for mixed results", () => {
    const result = makeResult([
      makeIssue({ issueNumber: 1, status: "completed", points: 3, retryCount: 0 }),
      makeIssue({ issueNumber: 2, status: "failed", points: 5, retryCount: 2 }),
      makeIssue({ issueNumber: 3, status: "completed", points: 2, retryCount: 1 }),
    ]);
    const metrics = calculateSprintMetrics(result);
    expect(metrics.planned).toBe(3);
    expect(metrics.completed).toBe(2);
    expect(metrics.failed).toBe(1);
    expect(metrics.pointsPlanned).toBe(10);
    expect(metrics.pointsCompleted).toBe(5);
    expect(metrics.velocity).toBe(5);
    expect(metrics.firstPassRate).toBe(33);
  });

  it("handles empty results", () => {
    const result = makeResult([]);
    const metrics = calculateSprintMetrics(result);
    expect(metrics.planned).toBe(0);
    expect(metrics.completed).toBe(0);
    expect(metrics.failed).toBe(0);
    expect(metrics.pointsPlanned).toBe(0);
    expect(metrics.pointsCompleted).toBe(0);
    expect(metrics.velocity).toBe(0);
    expect(metrics.avgDuration).toBe(0);
    expect(metrics.firstPassRate).toBe(0);
    expect(metrics.driftIncidents).toBe(0);
  });

  it("counts drift incidents from quality checks", () => {
    const result = makeResult([
      makeIssue({
        issueNumber: 1,
        qualityDetails: {
          passed: false,
          checks: [{ name: "scope_drift", passed: false, detail: "drift", category: "diff" }],
        },
      }),
      makeIssue({
        issueNumber: 2,
        qualityDetails: {
          passed: true,
          checks: [{ name: "scope_drift", passed: true, detail: "ok", category: "diff" }],
        },
      }),
      makeIssue({
        issueNumber: 3,
        qualityDetails: {
          passed: false,
          checks: [{ name: "scope_drift", passed: false, detail: "drift", category: "diff" }],
        },
      }),
    ]);
    const metrics = calculateSprintMetrics(result);
    expect(metrics.driftIncidents).toBe(2);
  });
});

describe("topFailedGates", () => {
  it("returns most commonly failed gates sorted by count", () => {
    const result = makeResult([
      makeIssue({
        qualityDetails: {
          passed: false,
          checks: [
            { name: "lint", passed: false, detail: "", category: "lint" },
            { name: "tests", passed: false, detail: "", category: "test" },
          ],
        },
      }),
      makeIssue({
        qualityDetails: {
          passed: false,
          checks: [
            { name: "lint", passed: false, detail: "", category: "lint" },
            { name: "scope_drift", passed: false, detail: "", category: "diff" },
          ],
        },
      }),
    ]);
    const output = topFailedGates(result);
    expect(output).toBe("lint (2), tests (1), scope_drift (1)");
  });

  it("returns empty string when no gates failed", () => {
    const result = makeResult([makeIssue()]);
    expect(topFailedGates(result)).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds only", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(150000)).toBe("2m 30s");
  });

  it("formats exact minutes", () => {
    expect(formatDuration(120000)).toBe("2m");
  });
});

describe("percent", () => {
  it("calculates percentage", () => {
    expect(percent(1, 4)).toBe(25);
  });

  it("returns 0 when total is 0", () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(5, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
  });
});

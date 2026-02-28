import { describe, it, expect } from "vitest";
import {
  buildExecutionGroups,
  detectCircularDependencies,
  validateDependencies,
  splitByFileOverlap,
} from "../../src/ceremonies/dep-graph.js";
import type { SprintIssue } from "../../src/types.js";

function makeIssue(
  number: number,
  depends_on: number[] = [],
  expectedFiles: string[] = [],
): SprintIssue {
  return {
    number,
    title: `Issue #${number}`,
    ice_score: 10,
    depends_on,
    acceptanceCriteria: "",
    expectedFiles,
    points: 1,
  };
}

describe("buildExecutionGroups", () => {
  it("returns empty array for empty issue set", () => {
    expect(buildExecutionGroups([])).toEqual([]);
  });

  it("groups parallel issues together (no deps)", () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const groups = buildExecutionGroups(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe(0);
    expect(groups[0].issues).toEqual([1, 2, 3]);
  });

  it("handles linear dependencies (A → B → C)", () => {
    const issues = [
      makeIssue(3, [2]),
      makeIssue(2, [1]),
      makeIssue(1),
    ];
    const groups = buildExecutionGroups(issues);
    expect(groups).toHaveLength(3);
    expect(groups[0].issues).toEqual([1]);
    expect(groups[1].issues).toEqual([2]);
    expect(groups[2].issues).toEqual([3]);
  });

  it("handles diamond dependencies (A,B → C; D → C)", () => {
    // C depends on A and B; D also depends on C
    const issues = [
      makeIssue(1),           // A — no deps
      makeIssue(2),           // B — no deps
      makeIssue(3, [1, 2]),   // C — depends on A, B
      makeIssue(4, [3]),      // D — depends on C
    ];
    const groups = buildExecutionGroups(issues);
    expect(groups).toHaveLength(3);
    expect(groups[0].issues).toEqual([1, 2]); // A, B parallel
    expect(groups[1].issues).toEqual([3]);    // C after A, B
    expect(groups[2].issues).toEqual([4]);    // D after C
  });

  it("throws on circular dependencies", () => {
    const issues = [
      makeIssue(1, [2]),
      makeIssue(2, [1]),
    ];
    expect(() => buildExecutionGroups(issues)).toThrow(
      /Circular dependencies detected/,
    );
  });

  it("ignores depends_on refs outside the issue set", () => {
    const issues = [makeIssue(1, [99])];
    const groups = buildExecutionGroups(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].issues).toEqual([1]);
  });
});

describe("detectCircularDependencies", () => {
  it("returns null when no cycles exist", () => {
    const issues = [makeIssue(1), makeIssue(2, [1])];
    expect(detectCircularDependencies(issues)).toBeNull();
  });

  it("detects a simple 2-node cycle", () => {
    const issues = [makeIssue(1, [2]), makeIssue(2, [1])];
    const cycles = detectCircularDependencies(issues);
    expect(cycles).not.toBeNull();
    expect(cycles!.length).toBeGreaterThan(0);
    // Each cycle should contain both nodes
    const flat = cycles!.flat();
    expect(flat).toContain(1);
    expect(flat).toContain(2);
  });

  it("detects a 3-node cycle", () => {
    const issues = [
      makeIssue(1, [3]),
      makeIssue(2, [1]),
      makeIssue(3, [2]),
    ];
    const cycles = detectCircularDependencies(issues);
    expect(cycles).not.toBeNull();
    expect(cycles!.length).toBeGreaterThan(0);
  });

  it("returns null for empty issue set", () => {
    expect(detectCircularDependencies([])).toBeNull();
  });
});

describe("validateDependencies", () => {
  it("returns valid when all deps exist", () => {
    const issues = [makeIssue(1), makeIssue(2, [1])];
    const result = validateDependencies(issues);
    expect(result.valid).toBe(true);
    expect(result.missingRefs).toEqual([]);
  });

  it("reports missing dependency references", () => {
    const issues = [makeIssue(1, [99, 100])];
    const result = validateDependencies(issues);
    expect(result.valid).toBe(false);
    expect(result.missingRefs).toEqual([
      { issue: 1, missingDep: 99 },
      { issue: 1, missingDep: 100 },
    ]);
  });

  it("returns valid for empty issue set", () => {
    const result = validateDependencies([]);
    expect(result.valid).toBe(true);
    expect(result.missingRefs).toEqual([]);
  });

  it("handles mixed valid and missing deps", () => {
    const issues = [
      makeIssue(1),
      makeIssue(2, [1, 50]),
    ];
    const result = validateDependencies(issues);
    expect(result.valid).toBe(false);
    expect(result.missingRefs).toEqual([
      { issue: 2, missingDep: 50 },
    ]);
  });
});

describe("splitByFileOverlap", () => {
  it("returns single group when no files overlap", () => {
    const issues = [
      makeIssue(1, [], ["src/a.ts"]),
      makeIssue(2, [], ["src/b.ts"]),
      makeIssue(3, [], ["src/c.ts"]),
    ];
    const issueMap = new Map(issues.map((i) => [i.number, i]));
    const result = splitByFileOverlap([1, 2, 3], issueMap);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it("splits overlapping issues into separate sub-groups", () => {
    const issues = [
      makeIssue(1, [], ["src/shared.ts", "src/a.ts"]),
      makeIssue(2, [], ["src/shared.ts", "src/b.ts"]),
      makeIssue(3, [], ["src/c.ts"]),
    ];
    const issueMap = new Map(issues.map((i) => [i.number, i]));
    const result = splitByFileOverlap([1, 2, 3], issueMap);

    // Issue 1 and 2 overlap on shared.ts → different sub-groups
    // Issue 3 has no overlap → in first sub-group
    expect(result.length).toBe(2);
    expect(result[0]).toContain(1);
    expect(result[0]).toContain(3);
    expect(result[1]).toContain(2);
  });

  it("handles single issue", () => {
    const issues = [makeIssue(1, [], ["src/a.ts"])];
    const issueMap = new Map(issues.map((i) => [i.number, i]));
    expect(splitByFileOverlap([1], issueMap)).toEqual([[1]]);
  });

  it("handles issues with no expectedFiles", () => {
    const issues = [
      makeIssue(1, [], []),
      makeIssue(2, [], []),
    ];
    const issueMap = new Map(issues.map((i) => [i.number, i]));
    const result = splitByFileOverlap([1, 2], issueMap);
    expect(result).toEqual([[1, 2]]);
  });

  it("handles three-way file overlap", () => {
    const issues = [
      makeIssue(1, [], ["src/shared.ts"]),
      makeIssue(2, [], ["src/shared.ts"]),
      makeIssue(3, [], ["src/shared.ts"]),
    ];
    const issueMap = new Map(issues.map((i) => [i.number, i]));
    const result = splitByFileOverlap([1, 2, 3], issueMap);

    // All three conflict with each other → 3 separate sub-groups
    expect(result.length).toBe(3);
    expect(result[0]).toEqual([1]);
    expect(result[1]).toEqual([2]);
    expect(result[2]).toEqual([3]);
  });
});

describe("buildExecutionGroups with file overlap", () => {
  it("splits same-level issues with file overlap into sequential groups", () => {
    const issues = [
      makeIssue(1, [], ["src/api.ts"]),
      makeIssue(2, [], ["src/api.ts"]),
      makeIssue(3, [], ["src/dashboard.ts"]),
    ];
    const groups = buildExecutionGroups(issues);

    // Issue 1 and 2 overlap on api.ts → separate groups
    // Issue 3 has no overlap → grouped with issue 1
    expect(groups.length).toBe(2);
    expect(groups[0].issues).toContain(1);
    expect(groups[0].issues).toContain(3);
    expect(groups[1].issues).toContain(2);
  });

  it("preserves dependency ordering alongside file overlap splitting", () => {
    const issues = [
      makeIssue(1, [], ["src/a.ts"]),
      makeIssue(2, [], ["src/a.ts"]),
      makeIssue(3, [1], ["src/b.ts"]),
    ];
    const groups = buildExecutionGroups(issues);

    // Level 0: issues 1, 2 (overlap on a.ts → split)
    // Level 1: issue 3 (depends on 1)
    expect(groups.length).toBe(3);
    expect(groups[0].issues).toEqual([1]);
    expect(groups[1].issues).toEqual([2]);
    expect(groups[2].issues).toEqual([3]);
  });

  it("keeps non-overlapping same-level issues in one group", () => {
    const issues = [
      makeIssue(1, [], ["src/a.ts"]),
      makeIssue(2, [], ["src/b.ts"]),
      makeIssue(3, [], ["src/c.ts"]),
    ];
    const groups = buildExecutionGroups(issues);
    expect(groups.length).toBe(1);
    expect(groups[0].issues).toEqual([1, 2, 3]);
  });
});

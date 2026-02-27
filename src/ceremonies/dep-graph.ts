import type { SprintIssue } from "../types.js";

export interface ExecutionGroup {
  group: number;
  issues: number[];
}

export interface ValidationResult {
  valid: boolean;
  missingRefs: Array<{ issue: number; missingDep: number }>;
}

/**
 * Detect circular dependencies among issues.
 * Returns the circular chains if found, null if no cycles.
 */
export function detectCircularDependencies(
  issues: SprintIssue[],
): number[][] | null {
  const issueSet = new Set(issues.map((i) => i.number));
  const adj = new Map<number, number[]>();
  for (const issue of issues) {
    adj.set(
      issue.number,
      issue.depends_on.filter((d) => issueSet.has(d)),
    );
  }

  const visited = new Set<number>();
  const inStack = new Set<number>();
  const cycles: number[][] = [];

  function dfs(node: number, path: number[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of adj.get(node) ?? []) {
      dfs(dep, path);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const issue of issues) {
    if (!visited.has(issue.number)) {
      dfs(issue.number, []);
    }
  }

  return cycles.length > 0 ? cycles : null;
}

/**
 * Validate that all depends_on references exist in the issue set.
 */
export function validateDependencies(issues: SprintIssue[]): ValidationResult {
  const issueNumbers = new Set(issues.map((i) => i.number));
  const missingRefs: Array<{ issue: number; missingDep: number }> = [];

  for (const issue of issues) {
    for (const dep of issue.depends_on) {
      if (!issueNumbers.has(dep)) {
        missingRefs.push({ issue: issue.number, missingDep: dep });
      }
    }
  }

  return { valid: missingRefs.length === 0, missingRefs };
}

/**
 * Build execution groups via topological sort.
 * Issues with no dependencies come first; parallel-safe issues
 * at the same dependency level are grouped together.
 * Throws on circular dependencies.
 */
export function buildExecutionGroups(issues: SprintIssue[]): ExecutionGroup[] {
  if (issues.length === 0) return [];

  const cycles = detectCircularDependencies(issues);
  if (cycles) {
    const detail = cycles
      .map((c) => c.join(" → ") + " → " + String(c[0]))
      .join("; ");
    throw new Error(`Circular dependencies detected: ${detail}`);
  }

  const issueSet = new Set(issues.map((i) => i.number));
  const adj = new Map<number, number[]>();
  for (const issue of issues) {
    adj.set(
      issue.number,
      issue.depends_on.filter((d) => issueSet.has(d)),
    );
  }

  // Compute depth (longest path from root) for each node via BFS/memoisation
  const depth = new Map<number, number>();

  function getDepth(node: number): number {
    if (depth.has(node)) return depth.get(node)!;
    const deps = adj.get(node) ?? [];
    if (deps.length === 0) {
      depth.set(node, 0);
      return 0;
    }
    const d = 1 + Math.max(...deps.map(getDepth));
    depth.set(node, d);
    return d;
  }

  for (const issue of issues) {
    getDepth(issue.number);
  }

  // Group by depth level
  const groups = new Map<number, number[]>();
  for (const issue of issues) {
    const d = depth.get(issue.number)!;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(issue.number);
  }

  const sortedLevels = Array.from(groups.keys()).sort((a, b) => a - b);
  return sortedLevels.map((level, idx) => ({
    group: idx,
    issues: groups.get(level)!.sort((a, b) => a - b),
  }));
}

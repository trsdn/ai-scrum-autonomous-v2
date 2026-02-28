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
 * Issues within the same level that share expectedFiles are
 * split into sequential sub-groups to avoid merge conflicts.
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
  const levelGroups = new Map<number, number[]>();
  for (const issue of issues) {
    const d = depth.get(issue.number)!;
    if (!levelGroups.has(d)) levelGroups.set(d, []);
    levelGroups.get(d)!.push(issue.number);
  }

  const issueMap = new Map(issues.map((i) => [i.number, i]));
  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

  // Split each level by file overlap — overlapping issues become sequential sub-groups
  const result: ExecutionGroup[] = [];
  let groupIdx = 0;
  for (const level of sortedLevels) {
    const levelIssues = levelGroups.get(level)!.sort((a, b) => a - b);
    const subGroups = splitByFileOverlap(levelIssues, issueMap);
    for (const sg of subGroups) {
      result.push({ group: groupIdx++, issues: sg });
    }
  }

  return result;
}

/**
 * Split a set of issue numbers into sub-groups where issues within each
 * sub-group have no overlapping expectedFiles. Uses greedy graph coloring:
 * issues that share files cannot be in the same group.
 */
export function splitByFileOverlap(
  issueNumbers: number[],
  issueMap: Map<number, SprintIssue>,
): number[][] {
  if (issueNumbers.length <= 1) return [issueNumbers];

  // Build file → issues index
  const fileToIssues = new Map<string, number[]>();
  for (const num of issueNumbers) {
    const issue = issueMap.get(num);
    if (!issue) continue;
    for (const file of issue.expectedFiles) {
      if (!fileToIssues.has(file)) fileToIssues.set(file, []);
      fileToIssues.get(file)!.push(num);
    }
  }

  // Build conflict adjacency (issues that share at least one file)
  const conflicts = new Map<number, Set<number>>();
  for (const num of issueNumbers) {
    conflicts.set(num, new Set());
  }
  for (const [, issueNums] of fileToIssues) {
    if (issueNums.length < 2) continue;
    for (let i = 0; i < issueNums.length; i++) {
      for (let j = i + 1; j < issueNums.length; j++) {
        conflicts.get(issueNums[i])!.add(issueNums[j]);
        conflicts.get(issueNums[j])!.add(issueNums[i]);
      }
    }
  }

  // Check if any conflicts exist at all
  const hasConflicts = Array.from(conflicts.values()).some((s) => s.size > 0);
  if (!hasConflicts) return [issueNumbers];

  // Greedy coloring — assign each issue to the earliest compatible sub-group
  const subGroups: number[][] = [];
  const assignment = new Map<number, number>();

  for (const num of issueNumbers) {
    const neighborColors = new Set(
      Array.from(conflicts.get(num) ?? [])
        .filter((n) => assignment.has(n))
        .map((n) => assignment.get(n)!),
    );

    let color = 0;
    while (neighborColors.has(color)) color++;

    if (color >= subGroups.length) subGroups.push([]);
    subGroups[color].push(num);
    assignment.set(num, color);
  }

  return subGroups;
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SprintConfig,
  SprintPlan,
  SprintIssue,
  IssueResult,
} from "../../src/types.js";

// --- Mocks ---

vi.mock("../../src/ceremonies/dep-graph.js", () => ({
  buildExecutionGroups: vi.fn(),
}));

vi.mock("../../src/ceremonies/execution.js", () => ({
  executeIssue: vi.fn(),
}));

vi.mock("../../src/git/merge.js", () => ({
  mergeBranch: vi.fn(),
}));

vi.mock("../../src/github/labels.js", () => ({
  setLabel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/logger.js", () => {
  const noop = () => {};
  const child = () => ({
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child,
  });
  return {
    logger: { child },
  };
});

import { runParallelExecution } from "../../src/ceremonies/parallel-dispatcher.js";
import { buildExecutionGroups } from "../../src/ceremonies/dep-graph.js";
import { executeIssue } from "../../src/ceremonies/execution.js";
import { mergeBranch } from "../../src/git/merge.js";
import { setLabel } from "../../src/github/labels.js";

// --- Helpers ---

function makeIssue(n: number, deps: number[] = []): SprintIssue {
  return {
    number: n,
    title: `Issue ${n}`,
    ice_score: 10,
    depends_on: deps,
    acceptanceCriteria: "AC",
    expectedFiles: [],
    points: 1,
  };
}

function makeResult(n: number, status: "completed" | "failed" = "completed"): IssueResult {
  return {
    issueNumber: n,
    status,
    qualityGatePassed: status === "completed",
    qualityDetails: { passed: status === "completed", checks: [] },
    branch: `sprint/1/issue-${n}`,
    duration_ms: 1000,
    filesChanged: ["src/a.ts"],
    retryCount: 0,
    points: 1,
  };
}

function makeConfig(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return {
    sprintNumber: 1,
    projectPath: "/project",
    baseBranch: "main",
    worktreeBase: "/tmp/wt",
    branchPattern: "sprint/{sprint}/issue-{issue}",
    maxParallelSessions: 3,
    maxIssuesPerSprint: 10,
    maxDriftIncidents: 2,
    maxRetries: 1,
    enableChallenger: false,
    autoRevertDrift: false,
    autoMerge: true,
    squashMerge: true,
    deleteBranchAfterMerge: true,
    sessionTimeoutMs: 60000,
    customInstructions: "",
    globalMcpServers: [],
    globalInstructions: [],
    phases: {},
    ...overrides,
  };
}

function makePlan(issues: SprintIssue[]): SprintPlan {
  return {
    sprintNumber: 1,
    sprint_issues: issues,
    execution_groups: [],
    estimated_points: issues.reduce((s, i) => s + i.points, 0),
    rationale: "test",
  };
}

const mockClient = {
  connect: vi.fn(),
  createSession: vi.fn(),
  sendPrompt: vi.fn(),
  endSession: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
} as unknown as import("../../src/acp/client.js").AcpClient;

// --- Tests ---

describe("runParallelExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a single group of parallel issues", async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2, 3] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce(makeResult(1))
      .mockResolvedValueOnce(makeResult(2))
      .mockResolvedValueOnce(makeResult(3));
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.results).toHaveLength(3);
    expect(result.sprint).toBe(1);
    expect(result.parallelizationRatio).toBe(3);
    expect(result.mergeConflicts).toBe(0);
    expect(executeIssue).toHaveBeenCalledTimes(3);
    expect(mergeBranch).toHaveBeenCalledTimes(3);
  });

  it("executes multiple sequential groups in order", async () => {
    const issues = [makeIssue(1), makeIssue(2, [1]), makeIssue(3, [1])];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1] },
      { group: 1, issues: [2, 3] },
    ]);

    const callOrder: number[] = [];
    vi.mocked(executeIssue).mockImplementation(async (_c, _cfg, issue) => {
      callOrder.push(issue.number);
      return makeResult(issue.number);
    });
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.results).toHaveLength(3);
    // Issue 1 must execute before issues 2 & 3
    expect(callOrder.indexOf(1)).toBeLessThan(callOrder.indexOf(2));
    expect(callOrder.indexOf(1)).toBeLessThan(callOrder.indexOf(3));
    expect(result.parallelizationRatio).toBe(1.5); // 3 issues / 2 groups
  });

  it("handles merge conflicts by marking issue as failed", async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce(makeResult(1))
      .mockResolvedValueOnce(makeResult(2));
    vi.mocked(mergeBranch)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, conflictFiles: ["src/a.ts"] });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.mergeConflicts).toBe(1);
    const failedResult = result.results.find((r) => r.issueNumber === 2);
    expect(failedResult?.status).toBe("failed");
    expect(failedResult?.qualityGatePassed).toBe(false);
    expect(setLabel).toHaveBeenCalledWith(2, "status:blocked");
  });

  it("skips merging when autoMerge is disabled", async () => {
    const issues = [makeIssue(1)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1] },
    ]);
    vi.mocked(executeIssue).mockResolvedValueOnce(makeResult(1));

    const result = await runParallelExecution(
      mockClient,
      makeConfig({ autoMerge: false }),
      makePlan(issues),
    );

    expect(result.results).toHaveLength(1);
    expect(mergeBranch).not.toHaveBeenCalled();
    expect(result.mergeConflicts).toBe(0);
  });

  it("respects concurrency limit via p-limit", async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3), makeIssue(4)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2, 3, 4] },
    ]);

    let concurrent = 0;
    let maxConcurrent = 0;

    vi.mocked(executeIssue).mockImplementation(async (_c, _cfg, issue) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return makeResult(issue.number);
    });
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    await runParallelExecution(
      mockClient,
      makeConfig({ maxParallelSessions: 2 }),
      makePlan(issues),
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(executeIssue).toHaveBeenCalledTimes(4);
  });

  it("pauses execution when all issues in a group fail", async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3, [1, 2])];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2] },
      { group: 1, issues: [3] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce(makeResult(1, "failed"))
      .mockResolvedValueOnce(makeResult(2, "failed"));

    const result = await runParallelExecution(
      mockClient,
      makeConfig({ autoMerge: false }),
      makePlan(issues),
    );

    // Group 1 should never execute because group 0 had all failures
    expect(result.results).toHaveLength(2);
    expect(executeIssue).toHaveBeenCalledTimes(2);
  });

  it("computes avgWorktreeLifetime from durations", async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce({ ...makeResult(1), duration_ms: 2000 })
      .mockResolvedValueOnce({ ...makeResult(2), duration_ms: 4000 });
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.avgWorktreeLifetime).toBe(3000);
  });

  it("tracks rejected executeIssue as failed IssueResult", async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce(makeResult(1))
      .mockRejectedValueOnce(new Error("session crashed"));
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.results).toHaveLength(2);
    const rejected = result.results.find((r) => r.issueNumber === 2)!;
    expect(rejected.status).toBe("failed");
    expect(rejected.qualityGatePassed).toBe(false);
    expect(rejected.retryCount).toBe(0);
    expect(rejected.duration_ms).toBe(0);
    expect(rejected.branch).toBe("sprint/1/issue-2");
  });

  it("counts fulfilled-failed and rejected correctly in mixed results", async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    vi.mocked(buildExecutionGroups).mockReturnValue([
      { group: 0, issues: [1, 2, 3] },
    ]);
    vi.mocked(executeIssue)
      .mockResolvedValueOnce(makeResult(1))              // fulfilled, completed
      .mockResolvedValueOnce(makeResult(2, "failed"))     // fulfilled, failed
      .mockRejectedValueOnce(new Error("timeout"));       // rejected
    vi.mocked(mergeBranch).mockResolvedValue({ success: true });

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan(issues),
    );

    expect(result.results).toHaveLength(3);
    const completed = result.results.filter((r) => r.status === "completed");
    const failed = result.results.filter((r) => r.status === "failed");
    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(2);
    expect(failed.map((r) => r.issueNumber).sort()).toEqual([2, 3]);
  });

  it("returns empty results for plan with no issues", async () => {
    vi.mocked(buildExecutionGroups).mockReturnValue([]);

    const result = await runParallelExecution(
      mockClient,
      makeConfig(),
      makePlan([]),
    );

    expect(result.results).toHaveLength(0);
    expect(result.parallelizationRatio).toBe(1);
    expect(result.avgWorktreeLifetime).toBe(0);
    expect(result.mergeConflicts).toBe(0);
  });
});

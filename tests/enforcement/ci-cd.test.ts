import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitForCiGreen, autoMergePr, reportDeployStatus, preSweepAutoMerge } from "../../src/enforcement/ci-cd.js";
import type { SprintConfig } from "../../src/types.js";

const mockExecGh = vi.fn();
const mockAddComment = vi.fn();
const mockListPullRequests = vi.fn();

vi.mock("../../src/github/issues.js", () => ({
  execGh: (...args: unknown[]) => mockExecGh(...args),
  addComment: (...args: unknown[]) => mockAddComment(...args),
}));

vi.mock("../../src/github/pull-requests.js", () => ({
  listPullRequests: (...args: unknown[]) => mockListPullRequests(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("waitForCiGreen", () => {
  it("returns green when all checks pass", async () => {
    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "success" },
      ]),
    );

    const result = await waitForCiGreen("feat/test", 5000, 100);

    expect(result.allGreen).toBe(true);
    expect(result.checks).toHaveLength(2);
  });

  it("returns non-green when checks fail", async () => {
    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "failure" },
      ]),
    );

    const result = await waitForCiGreen("feat/test", 5000, 100);

    expect(result.allGreen).toBe(false);
    expect(result.checks).toHaveLength(2);
  });

  it("times out gracefully", async () => {
    // Always return in-progress checks
    mockExecGh.mockResolvedValue(
      JSON.stringify([{ name: "build", status: "in_progress", conclusion: "" }]),
    );

    const result = await waitForCiGreen("feat/test", 200, 50);

    expect(result.allGreen).toBe(false);
    expect(result.checks).toHaveLength(1);
  });
});

describe("autoMergePr", () => {
  it("returns merged:true on success", async () => {
    mockExecGh.mockResolvedValueOnce("");

    const result = await autoMergePr(42);

    expect(result.merged).toBe(true);
    expect(result.prNumber).toBe(42);
    expect(result.error).toBeUndefined();
    expect(mockExecGh).toHaveBeenCalledWith(["pr", "merge", "42", "--delete-branch", "--squash"]);
  });

  it("returns merged:false with error on failure", async () => {
    mockExecGh.mockRejectedValueOnce(new Error("merge conflict"));

    const result = await autoMergePr(99);

    expect(result.merged).toBe(false);
    expect(result.prNumber).toBe(99);
    expect(result.error).toBe("merge conflict");
  });
});

describe("reportDeployStatus", () => {
  it("posts comment with success status", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);

    await reportDeployStatus(10, "success", "Deployed v1.0");

    expect(mockAddComment).toHaveBeenCalledWith(
      10,
      "## ✅ Deployment success\n\nDeployed v1.0",
    );
  });

  it("posts comment with failure status", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);

    await reportDeployStatus(10, "failure", "Build failed");

    expect(mockAddComment).toHaveBeenCalledWith(
      10,
      "## ❌ Deployment failure\n\nBuild failed",
    );
  });
});

describe("preSweepAutoMerge", () => {
  const mockConfig: SprintConfig = {
    sprintNumber: 1,
    sprintPrefix: "Sprint",
    sprintSlug: "test-sprint",
    projectPath: "/test",
    baseBranch: "main",
    worktreeBase: "/tmp/worktrees",
    branchPattern: "{prefix}/{sprint}/issue-{issue}",
    maxParallelSessions: 2,
    maxIssuesPerSprint: 5,
    maxDriftIncidents: 2,
    maxRetries: 1,
    enableChallenger: false,
    autoRevertDrift: false,
    backlogLabels: ["backlog"],
    autoMerge: true,
    squashMerge: true,
    deleteBranchAfterMerge: true,
    sessionTimeoutMs: 60000,
    customInstructions: "",
    autoApproveTools: false,
    allowToolPatterns: [],
    globalMcpServers: [],
    globalInstructions: [],
    phases: {},
  };

  it("merges PRs with clean state and green CI", async () => {
    mockListPullRequests.mockResolvedValueOnce([
      {
        number: 42,
        headRefName: "test-sprint/1/issue-10",
        state: "OPEN",
        mergeStateStatus: "CLEAN",
        url: "https://github.com/test/repo/pull/42",
      },
    ]);

    mockExecGh
      .mockResolvedValueOnce(
        JSON.stringify([
          { name: "build", status: "completed", conclusion: "success" },
        ]),
      )
      .mockResolvedValueOnce(""); // autoMergePr success

    const result = await preSweepAutoMerge(mockConfig, [10]);

    expect(result.merged).toEqual([42]);
    expect(result.skipped).toHaveLength(0);
    expect(mockExecGh).toHaveBeenCalledWith(["pr", "merge", "42", "--delete-branch", "--squash"]);
  });

  it("skips PRs with non-clean mergeable state", async () => {
    mockListPullRequests.mockResolvedValueOnce([
      {
        number: 43,
        headRefName: "test-sprint/1/issue-11",
        state: "OPEN",
        mergeStateStatus: "UNSTABLE",
        url: "https://github.com/test/repo/pull/43",
      },
    ]);

    const result = await preSweepAutoMerge(mockConfig, [11]);

    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].prNumber).toBe(43);
    expect(result.skipped[0].reason).toContain("not clean");
  });

  it("skips PRs with red CI", async () => {
    mockListPullRequests.mockResolvedValueOnce([
      {
        number: 44,
        headRefName: "test-sprint/1/issue-12",
        state: "OPEN",
        mergeStateStatus: "CLEAN",
        url: "https://github.com/test/repo/pull/44",
      },
    ]);

    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        { name: "build", status: "completed", conclusion: "failure" },
      ]),
    );

    const result = await preSweepAutoMerge(mockConfig, [12]);

    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].prNumber).toBe(44);
    expect(result.skipped[0].reason).toContain("CI not green");
  });

  it("handles no matching PRs for issue", async () => {
    mockListPullRequests.mockResolvedValueOnce([]);

    const result = await preSweepAutoMerge(mockConfig, [13]);

    expect(result.merged).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

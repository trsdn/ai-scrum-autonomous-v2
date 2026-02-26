import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SprintConfig,
  SprintIssue,
  QualityResult,
} from "../../src/types.js";

// Mock all external dependencies
vi.mock("../../src/git/worktree.js", () => ({
  createWorktree: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/enforcement/quality-gate.js", () => ({
  runQualityGate: vi.fn(),
}));

vi.mock("../../src/documentation/huddle.js", () => ({
  formatHuddleComment: vi.fn().mockReturnValue("huddle comment"),
  formatSprintLogEntry: vi.fn().mockReturnValue("log entry"),
}));

vi.mock("../../src/documentation/sprint-log.js", () => ({
  appendToSprintLog: vi.fn(),
}));

vi.mock("../../src/github/issues.js", () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/github/labels.js", () => ({
  setLabel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/git/diff-analysis.js", () => ({
  getChangedFiles: vi.fn().mockResolvedValue(["src/foo.ts"]),
}));

vi.mock("../../src/logger.js", () => {
  const noop = () => {};
  const childLogger = {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    child: () => childLogger,
  };
  return { logger: childLogger };
});

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi
      .fn()
      .mockResolvedValue("Worker prompt for issue #{{ISSUE_NUMBER}}"),
  },
}));

const { createWorktree, removeWorktree } = await import(
  "../../src/git/worktree.js"
);
const { runQualityGate } = await import(
  "../../src/enforcement/quality-gate.js"
);
const { formatHuddleComment, formatSprintLogEntry } = await import(
  "../../src/documentation/huddle.js"
);
const { appendToSprintLog } = await import(
  "../../src/documentation/sprint-log.js"
);
const { addComment } = await import("../../src/github/issues.js");
const { setLabel } = await import("../../src/github/labels.js");
const { getChangedFiles } = await import("../../src/git/diff-analysis.js");

const { executeIssue, handleQualityFailure } = await import(
  "../../src/ceremonies/execution.js"
);

// --- Helpers ---

function makeConfig(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return {
    sprintNumber: 3,
    projectPath: "/tmp/test-project",
    baseBranch: "main",
    worktreeBase: "/tmp/worktrees",
    branchPattern: "feat/{issue}-{slug}",
    maxParallelSessions: 2,
    maxIssuesPerSprint: 5,
    maxDriftIncidents: 2,
    maxRetries: 2,
    enableChallenger: false,
    autoRevertDrift: false,
    autoMerge: true,
    squashMerge: true,
    deleteBranchAfterMerge: true,
    sessionTimeoutMs: 60000,
    customInstructions: "",
    githubMcp: { command: "gh", args: [] },
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SprintIssue> = {}): SprintIssue {
  return {
    number: 42,
    title: "feat(api): add search endpoint",
    ice_score: 300,
    depends_on: [],
    acceptanceCriteria: "given query, returns results",
    expectedFiles: ["src/api.ts"],
    points: 3,
    ...overrides,
  };
}

function makeMockClient() {
  return {
    createSession: vi.fn().mockResolvedValue("session-abc"),
    sendPrompt: vi.fn().mockResolvedValue({
      response: "Done implementing issue",
      stopReason: "end_turn",
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  };
}

const passingQuality: QualityResult = {
  passed: true,
  checks: [
    { name: "tests-pass", passed: true, detail: "Tests passed" },
    { name: "lint-clean", passed: true, detail: "Lint clean" },
  ],
};

const failingQuality: QualityResult = {
  passed: false,
  checks: [
    { name: "tests-pass", passed: false, detail: "2 tests failed" },
    { name: "lint-clean", passed: true, detail: "Lint clean" },
  ],
};

// --- executeIssue ---

describe("executeIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes full flow with passing quality gate", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executeIssue(mockClient as any, makeConfig(), makeIssue());

    // Label set to in-progress first
    expect(setLabel).toHaveBeenCalledWith(42, "status:in-progress");

    // Worktree created
    expect(createWorktree).toHaveBeenCalledWith({
      path: "/tmp/worktrees/issue-42",
      branch: "sprint/3/issue-42",
      base: "main",
    });

    // ACP session created in worktree directory
    expect(mockClient.createSession).toHaveBeenCalledWith({
      cwd: "/tmp/worktrees/issue-42",
    });

    // Prompt sent
    expect(mockClient.sendPrompt).toHaveBeenCalledOnce();

    // Session ended
    expect(mockClient.endSession).toHaveBeenCalledWith("session-abc");

    // Quality gate ran
    expect(runQualityGate).toHaveBeenCalledOnce();

    // Huddle posted
    expect(formatHuddleComment).toHaveBeenCalledOnce();
    expect(addComment).toHaveBeenCalledWith(42, "huddle comment");
    expect(formatSprintLogEntry).toHaveBeenCalledOnce();
    expect(appendToSprintLog).toHaveBeenCalledWith(3, "log entry");

    // Final label
    expect(setLabel).toHaveBeenCalledWith(42, "status:done");

    // Worktree removed
    expect(removeWorktree).toHaveBeenCalledWith("/tmp/worktrees/issue-42");

    // Result
    expect(result.issueNumber).toBe(42);
    expect(result.status).toBe("completed");
    expect(result.qualityGatePassed).toBe(true);
    expect(result.branch).toBe("sprint/3/issue-42");
    expect(result.points).toBe(3);
    expect(result.filesChanged).toEqual(["src/foo.ts"]);
  });

  it("marks issue as blocked when quality gate fails after retries", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(failingQuality);

    const config = makeConfig({ maxRetries: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executeIssue(mockClient as any, config, makeIssue());

    expect(result.status).toBe("failed");
    expect(result.qualityGatePassed).toBe(false);

    // Final label should be blocked
    expect(setLabel).toHaveBeenCalledWith(42, "status:blocked");
  });

  it("cleans up worktree even when ACP session fails", async () => {
    const mockClient = makeMockClient();
    mockClient.sendPrompt.mockRejectedValue(new Error("session timeout"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      executeIssue(mockClient as any, makeConfig(), makeIssue()),
    ).rejects.toThrow("session timeout");

    // Worktree should still be removed
    expect(removeWorktree).toHaveBeenCalledWith("/tmp/worktrees/issue-42");

    // Session should still be ended
    expect(mockClient.endSession).toHaveBeenCalledWith("session-abc");
  });

  it("cleans up worktree even when worktree removal fails", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);
    vi.mocked(removeWorktree).mockRejectedValue(new Error("rm failed"));

    // Should not throw despite worktree removal failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executeIssue(mockClient as any, makeConfig(), makeIssue());

    expect(result.status).toBe("completed");
    expect(removeWorktree).toHaveBeenCalled();
  });
});

// --- handleQualityFailure ---

describe("handleQualityFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns failing result when retryCount >= maxRetries", async () => {
    const mockClient = makeMockClient();
    const config = makeConfig({ maxRetries: 2 });

    const result = await handleQualityFailure(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient as any,
      config,
      makeIssue(),
      "/tmp/worktrees/issue-42",
      failingQuality,
      2,
    );

    expect(result.passed).toBe(false);
    // No ACP session should be created
    expect(mockClient.createSession).not.toHaveBeenCalled();
  });

  it("retries and returns passing result on second attempt", async () => {
    const mockClient = makeMockClient();
    const config = makeConfig({ maxRetries: 2 });

    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);

    const result = await handleQualityFailure(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient as any,
      config,
      makeIssue(),
      "/tmp/worktrees/issue-42",
      failingQuality,
      0,
    );

    expect(result.passed).toBe(true);
    expect(mockClient.createSession).toHaveBeenCalledOnce();
    expect(mockClient.sendPrompt).toHaveBeenCalledOnce();
    expect(mockClient.endSession).toHaveBeenCalledOnce();
  });

  it("retries recursively until maxRetries is reached", async () => {
    const mockClient = makeMockClient();
    const config = makeConfig({ maxRetries: 3 });

    // All retries fail
    vi.mocked(runQualityGate).mockResolvedValue(failingQuality);

    const result = await handleQualityFailure(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient as any,
      config,
      makeIssue(),
      "/tmp/worktrees/issue-42",
      failingQuality,
      0,
    );

    expect(result.passed).toBe(false);
    // Should have created 3 sessions (retries 0→1, 1→2, 2→3=max)
    expect(mockClient.createSession).toHaveBeenCalledTimes(3);
    expect(runQualityGate).toHaveBeenCalledTimes(3);
  });

  it("ends ACP session even when sendPrompt fails during retry", async () => {
    const mockClient = makeMockClient();
    mockClient.sendPrompt.mockRejectedValue(new Error("retry failed"));
    const config = makeConfig({ maxRetries: 1 });

    await expect(
      handleQualityFailure(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockClient as any,
        config,
        makeIssue(),
        "/tmp/worktrees/issue-42",
        failingQuality,
        0,
      ),
    ).rejects.toThrow("retry failed");

    expect(mockClient.endSession).toHaveBeenCalledWith("session-abc");
  });
});

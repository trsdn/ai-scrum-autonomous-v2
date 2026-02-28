import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  SprintConfig,
  SprintIssue,
  QualityResult,
} from "../../src/types.js";

vi.mock("../../src/acp/session-config.js", () => ({
  resolveSessionConfig: vi.fn().mockResolvedValue({
    mcpServers: [],
    instructions: "",
    model: undefined,
  }),
}));

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
      .mockImplementation((filePath: string) => {
        if (filePath.includes("item-planner")) {
          return Promise.resolve("Plan for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}");
        }
        return Promise.resolve(`Worker prompt for issue #{{ISSUE_NUMBER}}

Files in scope: {{FILES_IN_SCOPE}}`);
      }),
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
await import("../../src/git/diff-analysis.js");

const { executeIssue } = await import(
  "../../src/ceremonies/execution.js"
);

// --- Helpers ---

function makeConfig(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return {
    sprintNumber: 3,
    sprintPrefix: "Sprint",
    sprintSlug: "sprint",
    projectPath: "/tmp/test-project",
    baseBranch: "main",
    worktreeBase: "/tmp/worktrees",
    branchPattern: "{prefix}/{sprint}/issue-{issue}",
    maxParallelSessions: 2,
    maxIssuesPerSprint: 5,
    maxDriftIncidents: 2,
    maxRetries: 2,
    enableChallenger: false,
    autoRevertDrift: false,
  backlogLabels: [],
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
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-abc", availableModes: [], currentMode: "", availableModels: [], currentModel: "" }),
    sendPrompt: vi.fn().mockResolvedValue({
      response: "Done implementing issue",
      stopReason: "end_turn",
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  };
}

const passingQuality: QualityResult = {
  passed: true,
  checks: [
    { name: "tests-pass", passed: true, detail: "Tests passed", category: "test" },
    { name: "lint-clean", passed: true, detail: "Lint clean", category: "lint" },
  ],
};

const failingQuality: QualityResult = {
  passed: false,
  checks: [
    { name: "tests-pass", passed: false, detail: "2 tests failed", category: "test" },
    { name: "lint-clean", passed: true, detail: "Lint clean", category: "lint" },
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
      mcpServers: [],
    });

    // Prompt sent
    expect(mockClient.sendPrompt).toHaveBeenCalledTimes(2);

    // Session ended
    expect(mockClient.endSession).toHaveBeenCalledWith("session-abc");

    // Quality gate ran
    expect(runQualityGate).toHaveBeenCalledOnce();

    // Huddle posted
    expect(formatHuddleComment).toHaveBeenCalledOnce();
    expect(addComment).toHaveBeenCalledWith(42, "huddle comment");
    expect(formatSprintLogEntry).toHaveBeenCalledOnce();
    expect(appendToSprintLog).toHaveBeenCalledWith(3, "log entry", undefined, "sprint");

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
    const result = await executeIssue(mockClient as any, makeConfig(), makeIssue());

    // Should return failed result (not throw)
    expect(result.status).toBe("failed");

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

  it("includes cleanupWarning in huddle entry when worktree removal fails", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);
    vi.mocked(removeWorktree).mockRejectedValue(new Error("rm failed"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeIssue(mockClient as any, makeConfig(), makeIssue());

    // Huddle entry should include cleanupWarning with the worktree path
    expect(formatHuddleComment).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupWarning: expect.stringContaining("/tmp/worktrees/issue-42"),
      }),
    );
    expect(formatSprintLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupWarning: expect.stringContaining("/tmp/worktrees/issue-42"),
      }),
    );
  });

  it("does not include cleanupWarning when worktree removal succeeds", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);
    vi.mocked(removeWorktree).mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeIssue(mockClient as any, makeConfig(), makeIssue());

    expect(formatHuddleComment).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupWarning: undefined,
      }),
    );
  });

  it("includes FILES_IN_SCOPE in worker prompt with expectedFiles", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);

    const issue = makeIssue({
      expectedFiles: ["src/api.ts", "tests/api.test.ts"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeIssue(mockClient as any, makeConfig(), issue);

    // Worker prompt (2nd call) should include formatted file list
    const workerPromptCall = mockClient.sendPrompt.mock.calls[1];
    expect(workerPromptCall).toBeDefined();
    expect(workerPromptCall![1]).toContain("- `src/api.ts`");
    expect(workerPromptCall![1]).toContain("- `tests/api.test.ts`");
  });

  it("includes fallback text when expectedFiles is empty", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);

    const issue = makeIssue({ expectedFiles: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeIssue(mockClient as any, makeConfig(), issue);

    // Worker prompt (2nd call) should include fallback message
    const workerPromptCall = mockClient.sendPrompt.mock.calls[1];
    expect(workerPromptCall).toBeDefined();
    expect(workerPromptCall![1]).toContain("No file restrictions");
  });

  it("formats FILES_IN_SCOPE as bullet list", async () => {
    const mockClient = makeMockClient();
    vi.mocked(runQualityGate).mockResolvedValue(passingQuality);

    const issue = makeIssue({
      expectedFiles: ["src/foo.ts", "src/bar.ts", "tests/baz.test.ts"],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await executeIssue(mockClient as any, makeConfig(), issue);

    const workerPromptCall = mockClient.sendPrompt.mock.calls[1];
    expect(workerPromptCall).toBeDefined();
    
    // Verify bullet format with newlines between items
    expect(workerPromptCall![1]).toMatch(/- `src\/foo\.ts`/);
    expect(workerPromptCall![1]).toMatch(/- `src\/bar\.ts`/);
    expect(workerPromptCall![1]).toMatch(/- `tests\/baz\.test\.ts`/);
  });
});


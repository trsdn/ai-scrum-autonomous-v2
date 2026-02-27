import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCodeReview } from "../../src/enforcement/code-review.js";
import type { SprintConfig, SprintIssue } from "../../src/types.js";

vi.mock("../../src/acp/session-config.js", () => ({
  resolveSessionConfig: vi.fn().mockResolvedValue({
    mcpServers: [],
    model: "claude-sonnet-4",
    instructions: null,
  }),
}));

vi.mock("../../src/git/diff-analysis.js", () => ({
  diffStat: vi.fn().mockResolvedValue({
    linesChanged: 42,
    filesChanged: 2,
    files: ["src/foo.ts", "tests/foo.test.ts"],
  }),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

function createMockClient() {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: "review-session-1" }),
    endSession: vi.fn().mockResolvedValue(undefined),
    sendPrompt: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
  };
}

const baseConfig: SprintConfig = {
  sprintNumber: 1,
  sprintPrefix: "Sprint",
  sprintSlug: "sprint",
  baseBranch: "main",
  projectPath: "/test/project",
  maxRetries: 1,
  maxParallelSessions: 2,
  sessionTimeoutMs: 60000,
  worktreeBase: "/tmp/worktrees",
  autoApproveTools: true,
  globalMcpServers: [],
  globalInstructions: [],
  phases: {},
};

const issue: SprintIssue = {
  number: 42,
  title: "Add foo feature",
  acceptanceCriteria: "Should do foo",
  points: 3,
};

describe("runCodeReview", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
  });

  it("returns approved when reviewer says APPROVED", async () => {
    client.sendPrompt.mockResolvedValue({
      response: "APPROVED: Clean implementation, tests cover all cases.\n- [suggestion] Consider adding JSDoc.",
    });

    const result = await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    expect(result.approved).toBe(true);
    expect(result.issues).toHaveLength(0); // suggestions are filtered out
    expect(result.feedback).toContain("APPROVED");
  });

  it("returns rejected with issues when reviewer says CHANGES_REQUESTED", async () => {
    client.sendPrompt.mockResolvedValue({
      response: [
        "CHANGES_REQUESTED: Missing error handling in edge case",
        "- uncaught exception in parseInput when input is null",
        "- no validation for negative numbers",
      ].join("\n"),
    });

    const result = await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    expect(result.approved).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toContain("uncaught exception");
    expect(result.issues[1]).toContain("no validation");
  });

  it("creates and tears down a session", async () => {
    client.sendPrompt.mockResolvedValue({ response: "APPROVED: looks good" });

    await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    expect(client.createSession).toHaveBeenCalledWith({
      cwd: "/tmp/worktrees/issue-42",
      mcpServers: [],
    });
    expect(client.endSession).toHaveBeenCalledWith("review-session-1");
  });

  it("sets the reviewer model", async () => {
    client.sendPrompt.mockResolvedValue({ response: "APPROVED: ok" });

    await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    expect(client.setModel).toHaveBeenCalledWith("review-session-1", "claude-sonnet-4");
  });

  it("ends session even if sendPrompt throws", async () => {
    client.sendPrompt.mockRejectedValue(new Error("timeout"));

    await expect(
      runCodeReview(
        client as never,
        baseConfig,
        issue,
        "sprint/1/issue-42",
        "/tmp/worktrees/issue-42",
      ),
    ).rejects.toThrow("timeout");

    expect(client.endSession).toHaveBeenCalledWith("review-session-1");
  });

  it("handles empty response", async () => {
    client.sendPrompt.mockResolvedValue({ response: "" });

    const result = await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    // Empty response defaults to not-approved (doesn't start with APPROVED)
    expect(result.approved).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it("filters out suggestion lines from issues list", async () => {
    client.sendPrompt.mockResolvedValue({
      response: [
        "APPROVED: implementation is correct",
        "- [suggestion] rename variable for clarity",
        "- [Suggestion] add more tests",
      ].join("\n"),
    });

    const result = await runCodeReview(
      client as never,
      baseConfig,
      issue,
      "sprint/1/issue-42",
      "/tmp/worktrees/issue-42",
    );

    expect(result.approved).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

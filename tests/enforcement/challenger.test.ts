import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AcpClient } from "../../src/acp/client.js";
import type { SprintConfig } from "../../src/types.js";

vi.mock("../../src/acp/session-config.js", () => ({
  resolveSessionConfig: vi.fn().mockResolvedValue({
    mcpServers: [],
    instructions: "",
    model: undefined,
  }),
}));

vi.mock("../../src/github/issues.js", () => ({
  execGh: vi.fn(),
  getIssue: vi.fn().mockResolvedValue({
    number: 42,
    title: "Fix auth bug",
    body: "Fix the bug",
    labels: [],
    state: "OPEN",
  }),
}));

vi.mock("../../src/git/diff-analysis.js", () => ({
  diffStat: vi.fn().mockResolvedValue({
    linesChanged: 50,
    filesChanged: 2,
    files: ["src/auth.ts", "tests/auth.test.ts"],
  }),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { runChallengerReview } from "../../src/enforcement/challenger.js";

function makeMockClient(response = "APPROVED: Looks good") {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-1", availableModes: [], currentMode: "", availableModels: [], currentModel: "" }),
    sendPrompt: vi
      .fn()
      .mockResolvedValue({ response, stopReason: "end_turn" }),
    endSession: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
  } as unknown as AcpClient;
}

const config: SprintConfig = {
  sprintNumber: 1,
  sprintPrefix: "Sprint",
  sprintSlug: "sprint",
  projectPath: "/tmp/project",
  baseBranch: "main",
  worktreeBase: "../wt",
  branchPattern: "{prefix}/{sprint}/issue-{issue}",
  maxParallelSessions: 4,
  maxIssuesPerSprint: 8,
  maxDriftIncidents: 2,
  maxRetries: 2,
  enableChallenger: true,
  autoRevertDrift: false,
  autoMerge: true,
  squashMerge: true,
  deleteBranchAfterMerge: true,
  sessionTimeoutMs: 600000,
  customInstructions: "",
  globalMcpServers: [],
  globalInstructions: [],
  phases: {},
};

describe("runChallengerReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves when response starts with APPROVED", async () => {
    const client = makeMockClient("APPROVED: Looks good");
    const result = await runChallengerReview(client, config, "feat/auth", 42);

    expect(result.approved).toBe(true);
    expect(result.feedback).toContain("APPROVED: Looks good");
  });

  it("rejects when response starts with REJECTED", async () => {
    const client = makeMockClient("REJECTED: Missing tests\nMore details");
    const result = await runChallengerReview(client, config, "feat/auth", 42);

    expect(result.approved).toBe(false);
    expect(result.feedback).toContain("REJECTED: Missing tests");
  });

  it("rejects when response does not start with APPROVED", async () => {
    const client = makeMockClient("Some other response");
    const result = await runChallengerReview(client, config, "feat/auth", 42);

    expect(result.approved).toBe(false);
  });

  it("passes issue details and diff stats to prompt", async () => {
    const client = makeMockClient("APPROVED: All good");
    await runChallengerReview(client, config, "feat/auth", 42);

    const prompt = (client.sendPrompt as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(prompt).toContain("Fix auth bug");
    expect(prompt).toContain("50");
  });
});

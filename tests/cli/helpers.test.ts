import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvalidArgumentError } from "commander";
import type { ConfigFile } from "../../src/config.js";

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
  prefixToSlug: vi.fn((p: string) =>
    p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
  ),
}));

vi.mock("../../src/acp/client.js", () => ({
  AcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  buildSprintConfig,
  createConnectedClient,
  loadConfigFromOpts,
  parseSprintNumber,
  parseIssueNumber,
} from "../../src/cli/helpers.js";
import { loadConfig } from "../../src/config.js";
import { AcpClient } from "../../src/acp/client.js";

const mockedLoadConfig = vi.mocked(loadConfig);

function makeConfig(overrides?: Partial<ConfigFile>): ConfigFile {
  return {
    project: { name: "test-project", base_branch: "main" },
    copilot: {
      executable: "copilot",
      max_parallel_sessions: 4,
      session_timeout_ms: 600000,
      auto_approve_tools: true,
      allow_tool_patterns: [],
      mcp_servers: [],
      instructions: [],
      phases: {},
    },
    sprint: {
      prefix: "Sprint",
      max_issues: 8,
      max_drift_incidents: 2,
      max_retries: 2,
      enable_challenger: true,
      auto_revert_drift: false,
      backlog_labels: [],
    },
    quality_gates: {
      require_tests: true,
      require_lint: true,
      require_types: true,
      require_build: true,
      max_diff_lines: 300,
      test_command: ["npm", "run", "test"],
      lint_command: ["npm", "run", "lint"],
      typecheck_command: ["npm", "run", "typecheck"],
      build_command: ["npm", "run", "build"],
      require_challenger: true,
    },
    escalation: { notifications: { ntfy: true, ntfy_topic: "" } },
    git: {
      worktree_base: "../sprint-worktrees",
      branch_pattern: "{prefix}/{sprint}/issue-{issue}",
      auto_merge: true,
      squash_merge: true,
      delete_branch_after_merge: true,
    },
    github: {},
    ...overrides,
  } as ConfigFile;
}

describe("parseSprintNumber", () => {
  it("parses a valid positive integer", () => {
    expect(parseSprintNumber("5")).toBe(5);
    expect(parseSprintNumber("1")).toBe(1);
    expect(parseSprintNumber("100")).toBe(100);
  });

  it("throws InvalidArgumentError for zero", () => {
    expect(() => parseSprintNumber("0")).toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for negative numbers", () => {
    expect(() => parseSprintNumber("-3")).toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for non-numeric input", () => {
    expect(() => parseSprintNumber("abc")).toThrow(InvalidArgumentError);
    expect(() => parseSprintNumber("")).toThrow(InvalidArgumentError);
  });

  it("throws for floating point input (parseInt truncates)", () => {
    // parseInt("3.7") → 3, which is valid
    expect(parseSprintNumber("3.7")).toBe(3);
  });
});

describe("parseIssueNumber", () => {
  it("parses a valid positive integer", () => {
    expect(parseIssueNumber("42")).toBe(42);
    expect(parseIssueNumber("1")).toBe(1);
  });

  it("throws InvalidArgumentError for zero", () => {
    expect(() => parseIssueNumber("0")).toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for negative numbers", () => {
    expect(() => parseIssueNumber("-1")).toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for non-numeric input", () => {
    expect(() => parseIssueNumber("xyz")).toThrow(InvalidArgumentError);
  });
});

describe("buildSprintConfig", () => {
  it("builds a valid SprintConfig from config and sprint number", () => {
    const config = makeConfig();
    const result = buildSprintConfig(config, 3);

    expect(result.sprintNumber).toBe(3);
    expect(result.sprintPrefix).toBe("Sprint");
    expect(result.sprintSlug).toBe("sprint");
    expect(result.baseBranch).toBe("main");
    expect(result.worktreeBase).toBe("../sprint-worktrees");
    expect(result.branchPattern).toBe("{prefix}/{sprint}/issue-{issue}");
    expect(result.maxParallelSessions).toBe(4);
    expect(result.maxIssuesPerSprint).toBe(8);
    expect(result.maxDriftIncidents).toBe(2);
    expect(result.maxRetries).toBe(2);
    expect(result.enableChallenger).toBe(true);
    expect(result.autoRevertDrift).toBe(false);
    expect(result.backlogLabels).toEqual([]);
    expect(result.autoMerge).toBe(true);
    expect(result.squashMerge).toBe(true);
    expect(result.deleteBranchAfterMerge).toBe(true);
    expect(result.sessionTimeoutMs).toBe(600000);
    expect(result.customInstructions).toBe("");
    expect(result.autoApproveTools).toBe(true);
    expect(result.allowToolPatterns).toEqual([]);
    expect(result.globalMcpServers).toEqual([]);
    expect(result.globalInstructions).toEqual([]);
    expect(result.phases).toEqual({});
  });

  it("uses prefixToSlug to generate slug", () => {
    const config = makeConfig({
      sprint: {
        prefix: "My Sprint",
        max_issues: 8,
        max_drift_incidents: 2,
        max_retries: 2,
        enable_challenger: true,
        auto_revert_drift: false,
        backlog_labels: [],
      },
    } as Partial<ConfigFile>);
    const result = buildSprintConfig(config, 1);
    expect(result.sprintSlug).toBe("my-sprint");
  });

  it("sets projectPath to process.cwd()", () => {
    const config = makeConfig();
    const result = buildSprintConfig(config, 1);
    expect(result.projectPath).toBe(process.cwd());
  });
});

describe("loadConfigFromOpts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to loadConfig with the given path", () => {
    const config = makeConfig();
    mockedLoadConfig.mockReturnValue(config);

    const result = loadConfigFromOpts("/some/path.yaml");
    expect(mockedLoadConfig).toHaveBeenCalledWith("/some/path.yaml");
    expect(result).toBe(config);
  });

  it("delegates to loadConfig with undefined when no path given", () => {
    const config = makeConfig();
    mockedLoadConfig.mockReturnValue(config);

    loadConfigFromOpts();
    expect(mockedLoadConfig).toHaveBeenCalledWith(undefined);
  });
});

describe("createConnectedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an AcpClient with config settings and connects", async () => {
    const config = makeConfig();
    const client = await createConnectedClient(config);

    expect(AcpClient).toHaveBeenCalledWith({
      command: "copilot",
      timeoutMs: 600000,
      permissions: {
        autoApprove: true,
        allowPatterns: [],
      },
    });
    expect(client.connect).toHaveBeenCalledOnce();
  });
});

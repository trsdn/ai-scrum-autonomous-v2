import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, substituteEnvVars } from "../src/config.js";

function writeTmpConfig(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const file = path.join(dir, "sprint-runner.config.yaml");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

const VALID_YAML = `
project:
  name: "test-project"
  base_branch: "main"

copilot:
  executable: "copilot"
  max_parallel_sessions: 2
  session_timeout_ms: 60000
  mcp_servers:
    - type: "stdio"
      name: "github"
      command: "npx"
      args: ["-y", "@github/mcp-server"]
  instructions: []
  phases:
    planner:
      model: "claude-opus-4.6"
    worker:
      model: "claude-sonnet-4.5"
    reviewer:
      model: "claude-opus-4.6"

sprint:
  max_issues: 4
  max_drift_incidents: 1
  max_retries: 1
  enable_challenger: false
  auto_revert_drift: true

quality_gates:
  require_tests: true
  require_lint: true
  require_types: false
  max_diff_lines: 200
  require_challenger: false
  require_ci_green: true
  ci_wait_timeout_ms: 120000

escalation:
  notifications:
    ntfy: true
    ntfy_topic: "my-topic"

git:
  worktree_base: "../wt"
  branch_pattern: "s/{sprint}/i-{issue}"
  auto_merge: false
  squash_merge: true
  delete_branch_after_merge: false
`;

describe("loadConfig", () => {
  it("loads and validates a complete config file", () => {
    const file = writeTmpConfig(VALID_YAML);
    const config = loadConfig(file);

    expect(config.project.name).toBe("test-project");
    expect(config.copilot.max_parallel_sessions).toBe(2);
    expect(config.sprint.max_issues).toBe(4);
    expect(config.sprint.enable_challenger).toBe(false);
    expect(config.quality_gates.max_diff_lines).toBe(200);
    expect(config.git.auto_merge).toBe(false);
    expect(config.copilot.mcp_servers[0]!.name).toBe("github");
    expect(config.escalation.notifications.ntfy_topic).toBe("my-topic");
  });

  it("applies defaults for optional fields", () => {
    const minimal = `
project:
  name: "minimal"
`;
    const file = writeTmpConfig(minimal);
    const config = loadConfig(file);

    expect(config.project.base_branch).toBe("main");
    expect(config.copilot.max_parallel_sessions).toBe(4);
    expect(config.sprint.max_issues).toBe(8);
    expect(config.sprint.max_retries).toBe(2);
    expect(config.git.squash_merge).toBe(true);
    expect(config.copilot.mcp_servers).toEqual([]);
  });

  it("throws on missing config file", () => {
    expect(() => loadConfig("/nonexistent/path.yaml")).toThrow(
      "Config file not found",
    );
  });

  it("throws on invalid config (missing required project.name)", () => {
    const invalid = `
project:
  base_branch: "main"
`;
    const file = writeTmpConfig(invalid);
    expect(() => loadConfig(file)).toThrow();
  });

  it("throws on invalid field type", () => {
    const invalid = `
project:
  name: "test"
copilot:
  max_parallel_sessions: "not-a-number"
`;
    const file = writeTmpConfig(invalid);
    expect(() => loadConfig(file)).toThrow();
  });
});

describe("substituteEnvVars", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("replaces env var placeholders with values", () => {
    process.env["MY_TOPIC"] = "replaced-topic";
    const result = substituteEnvVars('ntfy_topic: "${MY_TOPIC}"');
    expect(result).toBe('ntfy_topic: "replaced-topic"');
  });

  it("replaces undefined env vars with empty string", () => {
    delete process.env["UNDEFINED_VAR"];
    const result = substituteEnvVars("val: ${UNDEFINED_VAR}");
    expect(result).toBe("val: ");
  });

  it("handles multiple env vars in one string", () => {
    process.env["A"] = "alpha";
    process.env["B"] = "beta";
    const result = substituteEnvVars("${A} and ${B}");
    expect(result).toBe("alpha and beta");
  });

  it("leaves text without placeholders unchanged", () => {
    const text = "no substitution here";
    expect(substituteEnvVars(text)).toBe(text);
  });
});

describe("loadConfig with env var substitution", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("substitutes env vars in YAML before parsing", () => {
    process.env["TEST_NTFY_TOPIC"] = "env-topic";
    const yaml = `
project:
  name: "env-test"
escalation:
  notifications:
    ntfy: true
    ntfy_topic: "\${TEST_NTFY_TOPIC}"
`;
    const file = writeTmpConfig(yaml);
    const config = loadConfig(file);
    expect(config.escalation.notifications.ntfy_topic).toBe("env-topic");
  });
});

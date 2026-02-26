// Config loader: parse sprint-runner.config.yaml with Zod validation

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// --- Zod Schemas ---

const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
});

const ProjectSchema = z.object({
  name: z.string(),
  base_branch: z.string().default("main"),
});

const CopilotSchema = z.object({
  executable: z.string().default("copilot"),
  planner_model: z.string().default("claude-opus-4.6"),
  worker_model: z.string().default("claude-sonnet-4.5"),
  reviewer_model: z.string().default("claude-opus-4.6"),
  max_parallel_sessions: z.number().int().min(1).max(20).default(4),
  session_timeout_ms: z.number().int().min(0).default(600000),
});

const SprintSchema = z.object({
  max_issues: z.number().int().min(1).default(8),
  max_drift_incidents: z.number().int().min(0).default(2),
  max_retries: z.number().int().min(0).default(2),
  enable_challenger: z.boolean().default(true),
  auto_revert_drift: z.boolean().default(false),
});

const QualityGatesSchema = z.object({
  require_tests: z.boolean().default(true),
  require_lint: z.boolean().default(true),
  require_types: z.boolean().default(true),
  max_diff_lines: z.number().int().min(1).default(300),
  test_command: z.union([z.string(), z.array(z.string())]).default(["npm", "run", "test"]),
  lint_command: z.union([z.string(), z.array(z.string())]).default(["npm", "run", "lint"]),
  typecheck_command: z.union([z.string(), z.array(z.string())]).default(["npm", "run", "typecheck"]),
  require_challenger: z.boolean().default(true),
  require_ci_green: z.boolean().default(true),
  ci_wait_timeout_ms: z.number().int().min(0).default(300000),
});

const EscalationSchema = z.object({
  notifications: z
    .object({
      ntfy: z.boolean().default(true),
      ntfy_topic: z.string().default(""),
    })
    .default({}),
});

const GitSchema = z.object({
  worktree_base: z.string().default("../sprint-worktrees"),
  branch_pattern: z
    .string()
    .default("sprint/{sprint}/issue-{issue}"),
  auto_merge: z.boolean().default(true),
  squash_merge: z.boolean().default(true),
  delete_branch_after_merge: z.boolean().default(true),
});

const GitHubSchema = z.object({
  mcp_server: McpServerConfigSchema.default({
    command: "npx",
    args: ["-y", "@github/mcp-server"],
  }),
});

export const ConfigFileSchema = z.object({
  project: ProjectSchema,
  copilot: CopilotSchema.default({}),
  sprint: SprintSchema.default({}),
  quality_gates: QualityGatesSchema.default({}),
  escalation: EscalationSchema.default({}),
  git: GitSchema.default({}),
  github: GitHubSchema.default({}),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// --- Environment variable substitution ---

/** Replace `${VAR}` placeholders with values from process.env */
export function substituteEnvVars(text: string): string {
  return text.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      return "";
    }
    return value;
  });
}

// --- Loader ---

/**
 * Load and validate sprint-runner.config.yaml.
 * @param configPath – absolute or relative path to YAML config file.
 *   Defaults to `sprint-runner.config.yaml` in the current working directory.
 */
export function loadConfig(configPath?: string): ConfigFile {
  const resolvedPath = path.resolve(
    configPath ?? "sprint-runner.config.yaml",
  );

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const substituted = substituteEnvVars(raw);
  const parsed: unknown = parseYaml(substituted, { customTags: [] });

  return ConfigFileSchema.parse(parsed);
}

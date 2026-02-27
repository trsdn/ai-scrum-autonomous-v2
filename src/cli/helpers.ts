/**
 * Shared CLI helper functions — config builders, client factory, argument parsers.
 */

import { InvalidArgumentError } from "commander";
import { loadConfig, type ConfigFile, prefixToSlug } from "../config.js";
import { AcpClient } from "../acp/client.js";
import type { SprintConfig } from "../types.js";

/** Build a SprintConfig from the parsed config file and a sprint number. */
export function buildSprintConfig(config: ConfigFile, sprintNumber: number): SprintConfig {
  const prefix = config.sprint.prefix;
  const slug = prefixToSlug(prefix);
  return {
    sprintNumber,
    sprintPrefix: prefix,
    sprintSlug: slug,
    projectPath: process.cwd(),
    baseBranch: config.project.base_branch,
    worktreeBase: config.git.worktree_base,
    branchPattern: config.git.branch_pattern,
    maxParallelSessions: config.copilot.max_parallel_sessions,
    maxIssuesPerSprint: config.sprint.max_issues,
    maxDriftIncidents: config.sprint.max_drift_incidents,
    maxRetries: config.sprint.max_retries,
    enableChallenger: config.sprint.enable_challenger,
    autoRevertDrift: config.sprint.auto_revert_drift,
    backlogLabels: config.sprint.backlog_labels,
    autoMerge: config.git.auto_merge,
    squashMerge: config.git.squash_merge,
    deleteBranchAfterMerge: config.git.delete_branch_after_merge,
    sessionTimeoutMs: config.copilot.session_timeout_ms,
    customInstructions: "",
    autoApproveTools: config.copilot.auto_approve_tools,
    allowToolPatterns: config.copilot.allow_tool_patterns,
    globalMcpServers: config.copilot.mcp_servers,
    globalInstructions: config.copilot.instructions,
    phases: config.copilot.phases,
  };
}

/** Create and connect an AcpClient using config settings. */
export async function createConnectedClient(config: ConfigFile): Promise<AcpClient> {
  const client = new AcpClient({
    command: config.copilot.executable,
    timeoutMs: config.copilot.session_timeout_ms,
    permissions: {
      autoApprove: config.copilot.auto_approve_tools,
      allowPatterns: config.copilot.allow_tool_patterns,
    },
  });
  await client.connect();
  return client;
}

/** Load config from the global --config option. */
export function loadConfigFromOpts(configPath?: string): ConfigFile {
  return loadConfig(configPath);
}

/** Parse and validate a sprint number from CLI input. */
export function parseSprintNumber(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    throw new InvalidArgumentError("Sprint number must be a positive integer.");
  }
  return num;
}

/** Parse and validate an issue number from CLI input. */
export function parseIssueNumber(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    throw new InvalidArgumentError("Issue number must be a positive integer.");
  }
  return num;
}

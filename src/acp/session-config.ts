// Resolve MCP servers and instructions for a given ceremony phase.
// Merges global config with phase-specific overrides.

import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import type { SprintConfig, McpServerEntry, PhaseConfig } from "../types.js";
import { logger } from "../logger.js";

/** Known ceremony phase names used as keys in `copilot.phases`. */
export type CeremonyPhase =
  | "planner"
  | "worker"
  | "reviewer"
  | "refinement"
  | "planning"
  | "review"
  | "retro"
  | "challenger"
  | "conflict-resolver";

export interface ResolvedSessionConfig {
  mcpServers: McpServer[];
  instructions: string;
  model?: string;
}

/** Convert our config entry to the ACP SDK McpServer type. */
function toAcpMcpServer(entry: McpServerEntry): McpServer {
  switch (entry.type) {
    case "stdio":
      // ACP McpServerStdio has no `type` discriminant field
      return {
        name: entry.name,
        command: entry.command,
        args: entry.args,
        env: entry.env ?? [],
      };
    case "http":
      return {
        type: "http",
        name: entry.name,
        url: entry.url,
        headers: entry.headers ?? [],
      };
    case "sse":
      return {
        type: "sse",
        name: entry.name,
        url: entry.url,
        headers: entry.headers ?? [],
      };
  }
}

/** Load instruction files from disk and concatenate their contents. */
export async function loadInstructions(
  filePaths: string[],
  projectPath: string,
): Promise<string> {
  if (filePaths.length === 0) return "";

  const log = logger.child({ component: "session-config" });
  const parts: string[] = [];

  for (const filePath of filePaths) {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectPath, filePath);
    try {
      const content = await fs.readFile(resolved, "utf-8");
      parts.push(content);
    } catch (err: unknown) {
      log.warn({ filePath: resolved, err }, "failed to load instruction file — skipping");
    }
  }

  return parts.join("\n\n");
}

/**
 * Resolve the full session configuration for a ceremony phase.
 * Merges global MCP servers + instructions with phase-specific ones.
 */
export async function resolveSessionConfig(
  config: SprintConfig,
  phase: CeremonyPhase,
): Promise<ResolvedSessionConfig> {
  const phaseConfig: PhaseConfig | undefined = config.phases[phase];

  // Merge MCP servers: global + phase-specific
  const allEntries: McpServerEntry[] = [
    ...config.globalMcpServers,
    ...(phaseConfig?.mcp_servers ?? []),
  ];
  const mcpServers = allEntries.map(toAcpMcpServer);

  // Merge instructions: global + phase-specific
  const allInstructionPaths = [
    ...config.globalInstructions,
    ...(phaseConfig?.instructions ?? []),
  ];
  const instructions = await loadInstructions(allInstructionPaths, config.projectPath);

  // Model from phase config
  const model = phaseConfig?.model;

  return { mcpServers, instructions, model };
}

#!/usr/bin/env node

/**
 * Sprint Runner CLI — ACP-powered autonomous sprint engine.
 *
 * Usage:
 *   sprint-runner plan --sprint <N>
 *   sprint-runner execute-issue --issue <N> --sprint <N>
 *   sprint-runner check-quality --branch <branch>
 *   sprint-runner full-cycle --sprint <N>
 *   sprint-runner refine --sprint <N>
 *   sprint-runner review --sprint <N>
 *   sprint-runner retro --sprint <N>
 *   sprint-runner status
 *   sprint-runner pause
 *   sprint-runner resume
 *   sprint-runner metrics --sprint <N>
 *   sprint-runner drift-report --sprint <N>
 */

import { Command } from "commander";
import { registerCommands } from "./cli/commands.js";

// Graceful shutdown on SIGINT (Ctrl+C)
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down...");
  process.exit(130);
});

const program = new Command();

program
  .name("sprint-runner")
  .description("ACP-powered autonomous sprint engine for GitHub Copilot CLI")
  .version("0.1.0")
  .option("--config <path>", "Path to config file");

registerCommands(program);

program.parse();

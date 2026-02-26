#!/usr/bin/env node

/**
 * Sprint Runner CLI — ACP-powered autonomous sprint engine.
 *
 * Usage:
 *   sprint-runner plan --sprint <N>
 *   sprint-runner execute-issue --issue <N> --sprint <N>
 *   sprint-runner check-quality --branch <branch>
 *   sprint-runner full-cycle --sprint <N>
 */

import { Command } from "commander";

const program = new Command();

program
  .name("sprint-runner")
  .description("ACP-powered autonomous sprint engine for GitHub Copilot CLI")
  .version("0.1.0");

program
  .command("plan")
  .description("Run sprint planning")
  .requiredOption("--sprint <number>", "Sprint number", parseInt)
  .option("--dry-run", "Plan without executing", false)
  .action(async (opts) => {
    console.log(`Planning Sprint ${opts.sprint}${opts.dryRun ? " (dry run)" : ""}...`);
    // TODO: implement planning ceremony
  });

program
  .command("execute-issue")
  .description("Execute a single issue")
  .requiredOption("--issue <number>", "Issue number", parseInt)
  .requiredOption("--sprint <number>", "Sprint number", parseInt)
  .action(async (opts) => {
    console.log(`Executing Issue #${opts.issue} in Sprint ${opts.sprint}...`);
    // TODO: implement single issue execution
  });

program
  .command("check-quality")
  .description("Run quality gates on a branch")
  .requiredOption("--branch <name>", "Branch name")
  .action(async (opts) => {
    console.log(`Checking quality on branch ${opts.branch}...`);
    // TODO: implement quality gate check
  });

program
  .command("full-cycle")
  .description("Run a full sprint cycle: refine → plan → execute → review → retro")
  .requiredOption("--sprint <number>", "Sprint number", parseInt)
  .action(async (opts) => {
    console.log(`Starting full cycle for Sprint ${opts.sprint}...`);
    // TODO: implement full cycle
  });

program
  .command("status")
  .description("Show status of running workers")
  .action(async () => {
    console.log("No active workers.");
    // TODO: implement status reporting
  });

program.parse();

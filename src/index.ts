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

import { Command, InvalidArgumentError } from "commander";
import { loadConfig, type ConfigFile } from "./config.js";
import { AcpClient } from "./acp/client.js";
import { runSprintPlanning } from "./ceremonies/planning.js";
import { executeIssue } from "./ceremonies/execution.js";
import { runRefinement } from "./ceremonies/refinement.js";
import { runSprintReview } from "./ceremonies/review.js";
import { runSprintRetro } from "./ceremonies/retro.js";
import { runQualityGate, type QualityGateConfig } from "./enforcement/quality-gate.js";
import { getIssue } from "./github/issues.js";
import { readSprintLog } from "./documentation/sprint-log.js";
import { holisticDriftCheck } from "./enforcement/drift-control.js";
import { logger } from "./logger.js";
import type { SprintConfig, SprintIssue } from "./types.js";

/** Build a SprintConfig from the parsed config file and a sprint number. */
function buildSprintConfig(config: ConfigFile, sprintNumber: number): SprintConfig {
  return {
    sprintNumber,
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
    autoMerge: config.git.auto_merge,
    squashMerge: config.git.squash_merge,
    deleteBranchAfterMerge: config.git.delete_branch_after_merge,
    sessionTimeoutMs: config.copilot.session_timeout_ms,
    customInstructions: "",
    githubMcp: config.github.mcp_server,
  };
}

/** Create and connect an AcpClient using config settings. */
async function createConnectedClient(config: ConfigFile): Promise<AcpClient> {
  const client = new AcpClient({
    command: config.copilot.executable,
    timeoutMs: config.copilot.session_timeout_ms,
  });
  await client.connect();
  return client;
}

const program = new Command();

/** Parse and validate a sprint number from CLI input. */
function parseSprintNumber(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    throw new InvalidArgumentError("Sprint number must be a positive integer.");
  }
  return num;
}

/** Parse and validate an issue number from CLI input. */
function parseIssueNumber(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    throw new InvalidArgumentError("Issue number must be a positive integer.");
  }
  return num;
}

// Graceful shutdown on SIGINT (Ctrl+C)
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down...");
  process.exit(130);
});

program
  .name("sprint-runner")
  .description("ACP-powered autonomous sprint engine for GitHub Copilot CLI")
  .version("0.1.0")
  .option("--config <path>", "Path to config file");

// --- plan ---
program
  .command("plan")
  .description("Run sprint planning")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .option("--dry-run", "Plan without executing", false)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const sprintConfig = buildSprintConfig(config, opts.sprint);
      logger.info({ sprint: opts.sprint, dryRun: opts.dryRun }, "Starting sprint planning");

      const client = await createConnectedClient(config);
      try {
        const plan = await runSprintPlanning(client, sprintConfig);
        console.log("\n✅ Sprint plan created:");
        console.log(`  Sprint: ${plan.sprintNumber}`);
        console.log(`  Issues: ${plan.sprint_issues.length}`);
        console.log(`  Estimated points: ${plan.estimated_points}`);
        console.log(`  Rationale: ${plan.rationale}`);
        for (const issue of plan.sprint_issues) {
          console.log(`    #${issue.number} — ${issue.title} (${issue.points}pt, ICE=${issue.ice_score})`);
        }
      } finally {
        await client.disconnect();
      }
    } catch (err: unknown) {
      logger.error({ err }, "Sprint planning failed");
      console.error("❌ Sprint planning failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- execute-issue ---
program
  .command("execute-issue")
  .description("Execute a single issue")
  .requiredOption("--issue <number>", "Issue number", parseIssueNumber)
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const sprintConfig = buildSprintConfig(config, opts.sprint);
      logger.info({ issue: opts.issue, sprint: opts.sprint }, "Executing issue");

      // Fetch issue details from GitHub
      const ghIssue = await getIssue(opts.issue);
      const sprintIssue: SprintIssue = {
        number: ghIssue.number,
        title: ghIssue.title,
        ice_score: 0,
        depends_on: [],
        acceptanceCriteria: ghIssue.body ?? "",
        expectedFiles: [],
        points: 1,
      };

      const client = await createConnectedClient(config);
      try {
        const result = await executeIssue(client, sprintConfig, sprintIssue);
        console.log(`\n${result.status === "completed" ? "✅" : "❌"} Issue #${result.issueNumber}: ${result.status}`);
        console.log(`  Quality gate: ${result.qualityGatePassed ? "passed" : "failed"}`);
        console.log(`  Branch: ${result.branch}`);
        console.log(`  Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
        console.log(`  Files changed: ${result.filesChanged.length}`);
        console.log(`  Retries: ${result.retryCount}`);
        if (!result.qualityGatePassed) {
          for (const check of result.qualityDetails.checks.filter((c) => !c.passed)) {
            console.log(`    ✗ ${check.name}: ${check.detail}`);
          }
        }
      } finally {
        await client.disconnect();
      }
    } catch (err: unknown) {
      logger.error({ err }, "Issue execution failed");
      console.error("❌ Issue execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- check-quality ---
program
  .command("check-quality")
  .description("Run quality gates on a branch")
  .requiredOption("--branch <name>", "Branch name")
  .option("--base <branch>", "Base branch for diff comparison")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const baseBranch = opts.base ?? config.project.base_branch;
      logger.info({ branch: opts.branch, baseBranch }, "Running quality gate");

      const gateConfig: QualityGateConfig = {
        requireTests: config.quality_gates.require_tests,
        requireLint: config.quality_gates.require_lint,
        requireTypes: config.quality_gates.require_types,
        maxDiffLines: config.quality_gates.max_diff_lines,
        testCommand: config.quality_gates.test_command,
        lintCommand: config.quality_gates.lint_command,
        typecheckCommand: config.quality_gates.typecheck_command,
      };

      const result = await runQualityGate(gateConfig, process.cwd(), opts.branch, baseBranch);
      console.log(`\n${result.passed ? "✅" : "❌"} Quality gate: ${result.passed ? "PASSED" : "FAILED"}`);
      for (const check of result.checks) {
        console.log(`  ${check.passed ? "✓" : "✗"} ${check.name}: ${check.detail}`);
      }
      if (!result.passed) process.exit(1);
    } catch (err: unknown) {
      logger.error({ err }, "Quality gate check failed");
      console.error("❌ Quality gate check failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- refine ---
program
  .command("refine")
  .description("Run backlog refinement on type:idea issues")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const sprintConfig = buildSprintConfig(config, opts.sprint);
      logger.info({ sprint: opts.sprint }, "Starting refinement");

      const client = await createConnectedClient(config);
      try {
        const refined = await runRefinement(client, sprintConfig);
        console.log(`\n✅ Refinement complete: ${refined.length} issues refined`);
        for (const issue of refined) {
          console.log(`  #${issue.number} — ${issue.title} (ICE=${issue.ice_score})`);
        }
      } finally {
        await client.disconnect();
      }
    } catch (err: unknown) {
      logger.error({ err }, "Refinement failed");
      console.error("❌ Refinement failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- full-cycle ---
program
  .command("full-cycle")
  .description("Run a full sprint cycle: refine → plan → execute → review → retro")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const sprintConfig = buildSprintConfig(config, opts.sprint);
      logger.info({ sprint: opts.sprint }, "Starting full sprint cycle");

      const client = await createConnectedClient(config);
      try {
        // Step 1: Refine
        console.log("\n🔄 Phase 1/5: Refinement...");
        const refined = await runRefinement(client, sprintConfig);
        console.log(`  Refined ${refined.length} issues`);

        // Step 2: Plan
        console.log("\n🔄 Phase 2/5: Planning...");
        const plan = await runSprintPlanning(client, sprintConfig, refined);
        console.log(`  Planned ${plan.sprint_issues.length} issues (${plan.estimated_points} points)`);

        // Step 3: Execute all issues
        console.log("\n🔄 Phase 3/5: Execution...");
        const results = [];
        for (const issue of plan.sprint_issues) {
          console.log(`  Executing #${issue.number} — ${issue.title}...`);
          const result = await executeIssue(client, sprintConfig, issue);
          results.push(result);
          console.log(`    ${result.status === "completed" ? "✅" : "❌"} ${result.status}`);
        }

        const sprintResult = {
          results,
          sprint: opts.sprint,
          parallelizationRatio: 1,
          avgWorktreeLifetime: results.reduce((s, r) => s + r.duration_ms, 0) / (results.length || 1),
          mergeConflicts: 0,
        };

        // Step 4: Review
        console.log("\n🔄 Phase 4/5: Review...");
        const review = await runSprintReview(client, sprintConfig, sprintResult);
        console.log(`  ${review.demoItems.length} demo items, ${review.openItems.length} open items`);

        // Step 5: Retro
        console.log("\n🔄 Phase 5/5: Retrospective...");
        const retro = await runSprintRetro(client, sprintConfig, sprintResult, review);
        console.log(`  ${retro.wentWell.length} went well, ${retro.wentBadly.length} went badly`);
        console.log(`  ${retro.improvements.length} improvements identified`);

        // Summary
        const completed = results.filter((r) => r.status === "completed").length;
        console.log(`\n✅ Sprint ${opts.sprint} full cycle complete`);
        console.log(`  ${completed}/${results.length} issues completed`);
        console.log(`  ${review.summary}`);
      } finally {
        await client.disconnect();
      }
    } catch (err: unknown) {
      logger.error({ err }, "Full cycle failed");
      console.error("❌ Full cycle failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- review ---
program
  .command("review")
  .description("Run sprint review ceremony")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      logger.info({ sprint: opts.sprint, project: config.project.name }, "Starting sprint review");

      // Attempt to load sprint log for context
      let logContent: string;
      try {
        logContent = readSprintLog(opts.sprint);
      } catch {
        console.error(`❌ No sprint log found for Sprint ${opts.sprint}.`);
        console.error("   Run the full-cycle or execute issues first to generate sprint data.");
        process.exit(1);
      }

      console.log(`📋 Sprint ${opts.sprint} log loaded (${logContent.length} chars)`);
      console.log("⚠️  Sprint review requires a SprintResult from execution.");
      console.log("   Use 'full-cycle' for an end-to-end run, or provide sprint state.");
      console.log("   Sprint log preview:\n");
      console.log(logContent.slice(0, 500));
    } catch (err: unknown) {
      logger.error({ err }, "Sprint review failed");
      console.error("❌ Sprint review failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- retro ---
program
  .command("retro")
  .description("Run sprint retrospective ceremony")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      logger.info({ sprint: opts.sprint, project: config.project.name }, "Starting sprint retrospective");

      // Attempt to load sprint log for context
      let logContent: string;
      try {
        logContent = readSprintLog(opts.sprint);
      } catch {
        console.error(`❌ No sprint log found for Sprint ${opts.sprint}.`);
        console.error("   Run the full-cycle or execute issues first to generate sprint data.");
        process.exit(1);
      }

      console.log(`📋 Sprint ${opts.sprint} log loaded (${logContent.length} chars)`);
      console.log("⚠️  Sprint retro requires SprintResult and ReviewResult from prior ceremonies.");
      console.log("   Use 'full-cycle' for an end-to-end run, or provide sprint state.");
      console.log("   Sprint log preview:\n");
      console.log(logContent.slice(0, 500));
    } catch (err: unknown) {
      logger.error({ err }, "Sprint retrospective failed");
      console.error("❌ Sprint retrospective failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- status ---
program
  .command("status")
  .description("Show status of running workers")
  .action(async () => {
    console.log("📊 Worker Status");
    console.log("  No active workers.");
    console.log("  (Worker status tracking is not yet implemented.)");
  });

// --- pause ---
program
  .command("pause")
  .description("Pause running sprint execution")
  .action(async () => {
    console.log("⏸️  Pause");
    console.log("  Sprint pause/resume is not yet implemented.");
    console.log("  To stop execution, terminate the process (Ctrl+C).");
  });

// --- resume ---
program
  .command("resume")
  .description("Resume paused sprint execution")
  .action(async () => {
    console.log("▶️  Resume");
    console.log("  Sprint pause/resume is not yet implemented.");
    console.log("  Re-run the command to restart execution.");
  });

// --- metrics ---
program
  .command("metrics")
  .description("Show sprint metrics from sprint log")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      logger.info({ sprint: opts.sprint, project: config.project.name }, "Loading sprint metrics");

      let logContent: string;
      try {
        logContent = readSprintLog(opts.sprint);
      } catch {
        console.error(`❌ No sprint log found for Sprint ${opts.sprint}.`);
        process.exit(1);
      }

      console.log(`📈 Sprint ${opts.sprint} Metrics`);
      console.log("─".repeat(40));
      console.log(logContent);
    } catch (err: unknown) {
      logger.error({ err }, "Metrics retrieval failed");
      console.error("❌ Metrics retrieval failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- drift-report ---
program
  .command("drift-report")
  .description("Run drift analysis on current sprint changes")
  .requiredOption("--sprint <number>", "Sprint number", parseSprintNumber)
  .option("--changed-files <files...>", "List of changed files")
  .option("--expected-files <files...>", "List of expected files")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      logger.info({ sprint: opts.sprint, project: config.project.name }, "Running drift report");

      const changedFiles: string[] = opts.changedFiles ?? [];
      const expectedFiles: string[] = opts.expectedFiles ?? [];

      if (changedFiles.length === 0) {
        console.log("⚠️  No changed files provided. Use --changed-files to specify files.");
        console.log("   Example: sprint-runner drift-report --sprint 1 --changed-files src/a.ts src/b.ts --expected-files src/a.ts");
        process.exit(0);
      }

      const report = await holisticDriftCheck(changedFiles, expectedFiles);
      console.log(`\n📊 Drift Report — Sprint ${opts.sprint}`);
      console.log("─".repeat(40));
      console.log(`  Total files changed: ${report.totalFilesChanged}`);
      console.log(`  Planned changes:     ${report.plannedChanges}`);
      console.log(`  Drift percentage:    ${report.driftPercentage.toFixed(1)}%`);
      if (report.unplannedChanges.length > 0) {
        console.log("  Unplanned changes:");
        for (const file of report.unplannedChanges) {
          console.log(`    ⚠️  ${file}`);
        }
        process.exit(1);
      } else {
        console.log("  ✅ No unplanned changes detected.");
      }
    } catch (err: unknown) {
      logger.error({ err }, "Drift report failed");
      console.error("❌ Drift report failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();

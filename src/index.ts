#!/usr/bin/env node
// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.

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
import { loadConfig, type ConfigFile, prefixToSlug } from "./config.js";
import { AcpClient } from "./acp/client.js";
import { runSprintPlanning } from "./ceremonies/planning.js";
import { executeIssue } from "./ceremonies/execution.js";
import { runRefinement } from "./ceremonies/refinement.js";
import { runSprintReview } from "./ceremonies/review.js";
import { runSprintRetro } from "./ceremonies/retro.js";
import { runQualityGate, type QualityGateConfig } from "./enforcement/quality-gate.js";
import { getIssue, listIssues } from "./github/issues.js";
import { readSprintLog } from "./documentation/sprint-log.js";
import { holisticDriftCheck } from "./enforcement/drift-control.js";
import { getNextOpenMilestone } from "./github/milestones.js";
import { SprintRunner } from "./runner.js";
import { SprintEventBus } from "./tui/events.js";
import { logger, redirectLogToFile } from "./logger.js";
import type { SprintConfig, SprintIssue } from "./types.js";

/** Build a SprintConfig from the parsed config file and a sprint number. */
function buildSprintConfig(config: ConfigFile, sprintNumber: number): SprintConfig {
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
async function createConnectedClient(config: ConfigFile): Promise<AcpClient> {
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

// --- dashboard ---
program
  .command("dashboard")
  .description("Launch TUI dashboard — auto-detects sprint from GitHub milestones, loops continuously")
  .option("--sprint <number>", "Override sprint number (skip auto-detection)", parseSprintNumber)
  .option("--run", "Start sprint execution immediately")
  .option("--once", "Run only one sprint instead of looping (implies --run)")
  .option("--log-file <path>", "Log file path (default: sprint-runner.log)", "sprint-runner.log")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);

      // Auto-detect sprint from milestones if not specified
      let initialSprint = opts.sprint as number | undefined;
      if (!initialSprint) {
        const next = await getNextOpenMilestone(config.sprint.prefix);
        if (!next) {
          console.error(`❌ No open sprint milestones found (prefix: "${config.sprint.prefix}").`);
          console.error(`   Create a milestone named '${config.sprint.prefix} N' in GitHub, or use --sprint <number>.`);
          process.exit(1);
        }
        initialSprint = next.sprintNumber;
      }

      // Redirect all logger output to file so it doesn't corrupt the TUI
      redirectLogToFile(opts.logFile as string);
      logger.info({ sprint: initialSprint }, "Launching TUI dashboard");

      // Shared event bus for the TUI across sprints
      const eventBus = new SprintEventBus();

      // For the TUI we need an initial runner to mount the component
      const sprintConfig = buildSprintConfig(config, initialSprint);
      const runner = new SprintRunner(sprintConfig, eventBus);

      // Load saved sprint state (if any) to restore dashboard on restart
      const savedState = runner.loadSavedState();

      // Load milestone issues for initial display, enriched with saved state
      let initialIssues: { number: number; title: string; status: "planned" | "in-progress" | "done" | "failed" }[] = [];
      try {
        const milestoneIssues = await listIssues({
          milestone: `${config.sprint.prefix} ${initialSprint}`,
          state: "open",
        });

        // If we have a saved plan, use it to determine issue status
        const completedIssues = new Set<number>();
        if (savedState?.result) {
          for (const r of savedState.result.results) {
            if (r.status === "completed") completedIssues.add(r.issueNumber);
          }
        }

        initialIssues = milestoneIssues.map((i) => ({
          number: i.number,
          title: i.title,
          status: completedIssues.has(i.number) ? "done" as const : "planned" as const,
        }));
      } catch {
        // Non-critical — dashboard works without pre-loaded issues
      }

      // Dynamic import for Ink (ESM)
      const { render } = await import("ink");
      const { default: React } = await import("react");
      const { App } = await import("./tui/index.js");

      // Enter alternate screen buffer (like vim/htop)
      process.stdout.write("\x1b[?1049h");
      process.stdout.write("\x1b[H"); // cursor home

      // Start sprint loop (called by [g]o key or --run flag)
      const startLoop = () => {
        SprintRunner.sprintLoop(
          (sprintNumber) => buildSprintConfig(config, sprintNumber),
          eventBus,
        ).then((results) => {
          const allComplete = results.every((s) => s.phase === "complete");
          if (allComplete && results.length > 0) {
            // All sprints done — keep dashboard open, user can quit with [q]
            eventBus.emitTyped("log", { level: "info", message: "All sprints complete. Press [q] to quit." });
          }
          // On failure: dashboard stays open so user can see the error
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          eventBus.emitTyped("sprint:error", { error: msg });
          eventBus.emitTyped("log", { level: "error", message: `Sprint loop crashed: ${msg}` });
        });
      };

      // Start single sprint (called by --once flag)
      const startOnce = () => {
        runner.fullCycle().then((state) => {
          if (state.phase === "complete") {
            eventBus.emitTyped("log", { level: "info", message: "Sprint complete. Press [q] to quit." });
          }
          // On failure: dashboard stays open so user can see the error
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          eventBus.emitTyped("sprint:error", { error: msg });
          eventBus.emitTyped("log", { level: "error", message: `Sprint crashed: ${msg}` });
        });
      };

      const { unmount } = render(
        React.createElement(App, {
          runner,
          onStart: opts.once ? startOnce : startLoop,
          initialIssues,
        }),
      );

      const cleanup = () => {
        unmount();
        process.stdout.write("\x1b[?1049l"); // restore main screen
      };

      // Restore screen on exit
      process.on("exit", () => process.stdout.write("\x1b[?1049l"));
      process.on("SIGINT", () => { cleanup(); process.exit(0); });
      process.on("SIGTERM", () => { cleanup(); process.exit(0); });

      // Catch unhandled errors — show in dashboard instead of crashing
      process.on("unhandledRejection", (reason: unknown) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        eventBus.emitTyped("sprint:error", { error: msg });
        eventBus.emitTyped("log", { level: "error", message: `Unhandled error: ${msg}` });
      });
      process.on("uncaughtException", (err: Error) => {
        eventBus.emitTyped("sprint:error", { error: err.message });
        eventBus.emitTyped("log", { level: "error", message: `Uncaught exception: ${err.message}` });
      });

      // Auto-start if --run or --once was passed
      if (opts.run || opts.once) {
        if (opts.once) {
          startOnce();
        } else {
          startLoop();
        }
      }
    } catch (err: unknown) {
      logger.error({ err }, "Dashboard failed");
      console.error("❌ Dashboard failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// --- web dashboard ---
program
  .command("web")
  .description("Launch web dashboard — browser-based sprint monitor on localhost")
  .option("--sprint <number>", "Override sprint number (skip auto-detection)", parseSprintNumber)
  .option("--port <number>", "Dashboard server port (default: 9100)", (v) => parseInt(v, 10), 9100)
  .option("--run", "Start sprint execution immediately")
  .option("--once", "Run only one sprint instead of looping (implies --run)")
  .option("--log-file <path>", "Log file path (default: sprint-runner.log)", "sprint-runner.log")
  .option("--no-open", "Don't auto-open browser")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);

      // Auto-detect sprint
      let initialSprint = opts.sprint as number | undefined;
      if (!initialSprint) {
        const next = await getNextOpenMilestone(config.sprint.prefix);
        if (!next) {
          console.error(`❌ No open sprint milestones found (prefix: "${config.sprint.prefix}").`);
          console.error(`   Create a milestone named '${config.sprint.prefix} N' in GitHub, or use --sprint <number>.`);
          process.exit(1);
        }
        initialSprint = next.sprintNumber;
      }

      redirectLogToFile(opts.logFile as string);
      logger.info({ sprint: initialSprint }, "Launching web dashboard");

      const eventBus = new SprintEventBus();
      const sprintConfig = buildSprintConfig(config, initialSprint);
      const runner = new SprintRunner(sprintConfig, eventBus);

      // Load saved state
      runner.loadSavedState();

      // Load initial issues
      let currentIssues: { number: number; title: string; status: "planned" | "in-progress" | "done" | "failed" }[] = [];
      try {
        const milestoneIssues = await listIssues({
          milestone: `${config.sprint.prefix} ${initialSprint}`,
          state: "open",
        });

        const savedState = runner.getState();
        const completedIssues = new Set<number>();
        const failedIssues = new Set<number>();
        if (savedState?.result) {
          for (const r of savedState.result.results) {
            if (r.status === "completed") completedIssues.add(r.issueNumber);
            else failedIssues.add(r.issueNumber);
          }
        }

        currentIssues = milestoneIssues.map((i) => ({
          number: i.number,
          title: i.title,
          status: completedIssues.has(i.number) ? "done" as const
            : failedIssues.has(i.number) ? "failed" as const
            : "planned" as const,
        }));
      } catch {
        // Non-critical
      }

      // Update issues from events
      eventBus.onTyped("sprint:planned", ({ issues: plannedIssues }) => {
        // Replace issue list with what the planner actually selected
        currentIssues = plannedIssues.map((i) => ({
          number: i.number,
          title: i.title,
          status: "planned" as const,
        }));
      });
      eventBus.onTyped("issue:start", ({ issue }) => {
        const existing = currentIssues.find((i) => i.number === issue.number);
        if (existing) {
          existing.status = "in-progress";
        } else {
          currentIssues.push({ number: issue.number, title: issue.title, status: "in-progress" });
        }
      });
      eventBus.onTyped("issue:done", ({ issueNumber }) => {
        const issue = currentIssues.find((i) => i.number === issueNumber);
        if (issue) issue.status = "done";
      });
      eventBus.onTyped("issue:fail", ({ issueNumber }) => {
        const issue = currentIssues.find((i) => i.number === issueNumber);
        if (issue) issue.status = "failed";
      });

      // Start/loop functions
      const startLoop = () => {
        SprintRunner.sprintLoop(
          (sprintNumber) => buildSprintConfig(config, sprintNumber),
          eventBus,
        ).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          eventBus.emitTyped("sprint:error", { error: msg });
          eventBus.emitTyped("log", { level: "error", message: `Sprint loop crashed: ${msg}` });
        });
      };

      const startOnce = () => {
        runner.fullCycle().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          eventBus.emitTyped("sprint:error", { error: msg });
          eventBus.emitTyped("log", { level: "error", message: `Sprint crashed: ${msg}` });
        });
      };

      const onStart = opts.once ? startOnce : startLoop;

      // Launch WebSocket server
      const { DashboardWebServer } = await import("./dashboard/ws-server.js");
      const dashboardServer = new DashboardWebServer({
        port: opts.port as number,
        host: "localhost",
        eventBus,
        getState: () => runner.getState(),
        getIssues: () => currentIssues,
        onStart,
        projectPath: process.cwd(),
        activeSprintNumber: initialSprint,
        sprintPrefix: config.sprint.prefix,
        sprintSlug: prefixToSlug(config.sprint.prefix),
      });

      await dashboardServer.start();
      const url = `http://localhost:${opts.port as number}`;
      console.log(`\n  🌐 Dashboard running at ${url}\n`);

      // Auto-open browser
      if (opts.open !== false) {
        const { exec } = await import("node:child_process");
        const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${openCmd} ${url}`);
      }

      // Graceful shutdown
      const cleanup = async () => {
        await dashboardServer.stop();
        process.exit(0);
      };
      process.on("SIGINT", () => { cleanup(); });
      process.on("SIGTERM", () => { cleanup(); });

      // Catch unhandled errors
      process.on("unhandledRejection", (reason: unknown) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        eventBus.emitTyped("sprint:error", { error: msg });
        eventBus.emitTyped("log", { level: "error", message: `Unhandled error: ${msg}` });
      });

      // Auto-start if flags set
      if (opts.run || opts.once) {
        onStart();
      }
    } catch (err: unknown) {
      logger.error({ err }, "Web dashboard failed");
      console.error("❌ Web dashboard failed:", err instanceof Error ? err.message : err);
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
        logContent = readSprintLog(opts.sprint, undefined, prefixToSlug(config.sprint.prefix));
      } catch {
        console.error(`❌ No sprint log found for ${config.sprint.prefix} ${opts.sprint}.`);
        console.error("   Run the full-cycle or execute issues first to generate sprint data.");
        process.exit(1);
      }

      console.log(`📋 ${config.sprint.prefix} ${opts.sprint} log loaded (${logContent.length} chars)`);
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
        logContent = readSprintLog(opts.sprint, undefined, prefixToSlug(config.sprint.prefix));
      } catch {
        console.error(`❌ No sprint log found for ${config.sprint.prefix} ${opts.sprint}.`);
        console.error("   Run the full-cycle or execute issues first to generate sprint data.");
        process.exit(1);
      }

      console.log(`📋 ${config.sprint.prefix} ${opts.sprint} log loaded (${logContent.length} chars)`);
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
        logContent = readSprintLog(opts.sprint, undefined, prefixToSlug(config.sprint.prefix));
      } catch {
        console.error(`❌ No sprint log found for ${config.sprint.prefix} ${opts.sprint}.`);
        process.exit(1);
      }

      console.log(`📈 ${config.sprint.prefix} ${opts.sprint} Metrics`);
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

import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import { ACP_MODES } from "../acp/client.js";
import { resolveSessionConfig } from "../acp/session-config.js";
import type {
  SprintConfig,
  SprintIssue,
  IssueResult,
  QualityResult,
  HuddleEntry,
  CodeReviewResult,
} from "../types.js";
import { createWorktree, removeWorktree } from "../git/worktree.js";
import { runQualityGate } from "../enforcement/quality-gate.js";
import { runCodeReview } from "../enforcement/code-review.js";
import {
  formatHuddleComment,
  formatSprintLogEntry,
} from "../documentation/huddle.js";
import { appendToSprintLog } from "../documentation/sprint-log.js";
import { addComment } from "../github/issues.js";
import { setLabel } from "../github/labels.js";
import { getChangedFiles } from "../git/diff-analysis.js";
import { substitutePrompt, extractJson, sanitizePromptInput } from "./helpers.js";
import { logger } from "../logger.js";
import type { SprintEventBus } from "../tui/events.js";

const DEFAULT_QUALITY_GATE_CONFIG = {
  requireTests: true,
  requireLint: true,
  requireTypes: true,
  maxDiffLines: 300,
  testCommand: ["npm", "run", "test"],
  lintCommand: ["npm", "run", "lint"],
  typecheckCommand: ["npm", "run", "typecheck"],
};

/** Build branch name from config pattern. */
function buildBranch(config: SprintConfig, issueNumber: number): string {
  return config.branchPattern
    .replace("{prefix}", config.sprintSlug)
    .replace("{sprint}", String(config.sprintNumber))
    .replace("{issue}", String(issueNumber));
}

/**
 * Handle a quality gate failure by retrying with feedback via a new ACP session.
 * Recurses until the gate passes or maxRetries is reached.
 */
export async function handleQualityFailure(
  client: AcpClient,
  config: SprintConfig,
  issue: SprintIssue,
  worktreePath: string,
  qualityResult: QualityResult,
  retryCount: number,
  eventBus?: SprintEventBus,
): Promise<QualityResult> {
  if (retryCount >= config.maxRetries) {
    return qualityResult;
  }

  const log = logger.child({ ceremony: "execution", issue: issue.number });

  const failedChecks = qualityResult.checks
    .filter((c) => !c.passed)
    .map((c) => `- ${c.name}: ${c.detail}`)
    .join("\n");

  const feedbackPrompt = [
    `## Quality Gate Failed — Retry ${retryCount + 1}/${config.maxRetries}`,
    "",
    `The quality gate for issue #${issue.number} failed with the following checks:`,
    "",
    failedChecks,
    "",
    "Please fix the failing checks and try again.",
  ].join("\n");

  log.info({ retryCount: retryCount + 1 }, "retrying after quality failure");

  const sessionConfig = await resolveSessionConfig(config, "worker");
  const { sessionId } = await client.createSession({
    cwd: worktreePath,
    mcpServers: sessionConfig.mcpServers,
  });
  eventBus?.emitTyped("session:start", {
    sessionId,
    role: "worker-retry",
    issueNumber: issue.number,
    model: sessionConfig.model,
  });
  try {
    await client.sendPrompt(sessionId, feedbackPrompt, config.sessionTimeoutMs);
  } finally {
    eventBus?.emitTyped("session:end", { sessionId });
    await client.endSession(sessionId);
  }

  const branch = buildBranch(config, issue.number);
  const newResult = await runQualityGate(
    DEFAULT_QUALITY_GATE_CONFIG,
    worktreePath,
    branch,
    config.baseBranch,
  );

  if (newResult.passed) {
    return newResult;
  }

  return handleQualityFailure(
    client,
    config,
    issue,
    worktreePath,
    newResult,
    retryCount + 1,
    eventBus,
  );
}

/**
 * Execute a single sprint issue end-to-end:
 * label → worktree → ACP session → quality gate → huddle → cleanup.
 */
export async function executeIssue(
  client: AcpClient,
  config: SprintConfig,
  issue: SprintIssue,
  eventBus?: SprintEventBus,
): Promise<IssueResult> {
  const log = logger.child({ ceremony: "execution", issue: issue.number });
  const startTime = Date.now();
  const progress = (step: string) => eventBus?.emitTyped("issue:progress", { issueNumber: issue.number, step });

  const branch = buildBranch(config, issue.number);
  const worktreePath = path.resolve(config.worktreeBase, `issue-${issue.number}`);

  // Step 1: Set in-progress label
  await setLabel(issue.number, "status:in-progress");
  log.info("issue marked in-progress");
  progress("creating worktree");

  // Step 2: Create worktree
  await createWorktree({
    path: worktreePath,
    branch,
    base: config.baseBranch,
  });
  log.info({ worktreePath, branch }, "worktree created");

  let qualityResult: QualityResult = { passed: false, checks: [] };
  let codeReview: CodeReviewResult | undefined;
  let retryCount = 0;
  let filesChanged: string[] = [];
  let status: "completed" | "failed" = "failed";

  try {
    // Step 3: Resolve session config and create ACP session
    const plannerConfig = await resolveSessionConfig(config, "planner");
    const { sessionId } = await client.createSession({
      cwd: worktreePath,
      mcpServers: plannerConfig.mcpServers,
    });
    eventBus?.emitTyped("session:start", {
      sessionId,
      role: "worker",
      issueNumber: issue.number,
      model: plannerConfig.model,
    });

    try {
      const promptVars = {
        PROJECT_NAME: path.basename(config.projectPath),
        REPO_OWNER: "",
        REPO_NAME: path.basename(config.projectPath),
        SPRINT_NUMBER: String(config.sprintNumber),
        ISSUE_NUMBER: String(issue.number),
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: sanitizePromptInput(issue.acceptanceCriteria),
        BRANCH_NAME: branch,
        BASE_BRANCH: config.baseBranch,
        WORKTREE_PATH: worktreePath,
        MAX_DIFF_LINES: String(DEFAULT_QUALITY_GATE_CONFIG.maxDiffLines),
      };

      // Step 4: Plan phase — switch to Plan Mode and create implementation plan
      let implementationPlan = "";
      try {
        await client.setMode(sessionId, ACP_MODES.PLAN);
        if (plannerConfig.model) {
          await client.setModel(sessionId, plannerConfig.model);
        }
        log.info("switched to Plan mode");
        progress("planning implementation");

        const planTemplatePath = path.join(config.projectPath, "prompts", "item-planner.md");
        const planTemplate = await fs.readFile(planTemplatePath, "utf-8");
        let planPrompt = substitutePrompt(planTemplate, promptVars);

        // Prepend planner instructions
        if (plannerConfig.instructions) {
          planPrompt = plannerConfig.instructions + "\n\n" + planPrompt;
        }

        const planResult = await client.sendPrompt(sessionId, planPrompt, config.sessionTimeoutMs);
        implementationPlan = planResult.response;

        // Try to parse as JSON for structured logging
        try {
          const planJson = extractJson<{ summary: string; steps: unknown[] }>(implementationPlan);
          log.info(
            { summary: planJson.summary, stepCount: planJson.steps?.length ?? 0 },
            "implementation plan created",
          );
        } catch {
          log.info({ responseLength: implementationPlan.length }, "implementation plan created (unstructured)");
        }

        // Post plan as issue comment
        await addComment(
          issue.number,
          `### 📋 Implementation Plan — #${issue.number}\n\n${implementationPlan}`,
        );
        log.info("plan posted to issue");
      } catch (err: unknown) {
        log.warn({ err }, "plan mode failed — proceeding with direct execution");
      }

      // Step 5: Execution phase — switch to Agent Mode and implement
      const workerConfig = await resolveSessionConfig(config, "worker");
      await client.setMode(sessionId, ACP_MODES.AGENT);
      if (workerConfig.model) {
        await client.setModel(sessionId, workerConfig.model);
      }
      log.info("switched to Agent mode");
      progress("implementing");

      const workerTemplatePath = path.join(config.projectPath, "prompts", "worker.md");
      const workerTemplate = await fs.readFile(workerTemplatePath, "utf-8");
      let workerPrompt = substitutePrompt(workerTemplate, promptVars);

      // Prepend worker instructions
      if (workerConfig.instructions) {
        workerPrompt = workerConfig.instructions + "\n\n" + workerPrompt;
      }

      // Append the plan to give the worker context
      if (implementationPlan) {
        workerPrompt += `\n\n## Implementation Plan (follow this)\n\n${implementationPlan}`;
      }

      // Step 6: Send worker prompt to ACP
      await client.sendPrompt(sessionId, workerPrompt, config.sessionTimeoutMs);
    } finally {
      eventBus?.emitTyped("session:end", { sessionId });
      await client.endSession(sessionId);
    }
    progress("quality gate");
    qualityResult = await runQualityGate(
      DEFAULT_QUALITY_GATE_CONFIG,
      worktreePath,
      branch,
      config.baseBranch,
    );

    // Step 7: Retry on failure
    if (!qualityResult.passed) {
      qualityResult = await handleQualityFailure(
        client,
        config,
        issue,
        worktreePath,
        qualityResult,
        0,
        eventBus,
      );
      retryCount = qualityResult.passed ? 0 : config.maxRetries;
    }

    // Step 8: Code review (only if quality gate passed)
    if (qualityResult.passed) {
      try {
        progress("code review");
        codeReview = await runCodeReview(client, config, issue, branch, worktreePath);
        log.info({ approved: codeReview.approved, issues: codeReview.issues.length }, "code review completed");

        if (!codeReview.approved) {
          log.warn("code review rejected — attempting fix");
          // Send feedback to worker for a fix attempt
          const fixConfig = await resolveSessionConfig(config, "worker");
          const { sessionId: fixSession } = await client.createSession({
            cwd: worktreePath,
            mcpServers: fixConfig.mcpServers,
          });
          try {
            if (fixConfig.model) {
              await client.setModel(fixSession, fixConfig.model);
            }
            const fixPrompt = [
              "The automated code review found issues with your implementation.",
              "Please address the following feedback:\n",
              codeReview.feedback,
              "\nFix the issues and ensure tests still pass.",
            ].join("\n");
            await client.sendPrompt(fixSession, fixPrompt, config.sessionTimeoutMs);
          } finally {
            await client.endSession(fixSession);
          }

          // Re-run quality gate after fix
          qualityResult = await runQualityGate(
            DEFAULT_QUALITY_GATE_CONFIG,
            worktreePath,
            branch,
            config.baseBranch,
          );

          if (qualityResult.passed) {
            // Re-run code review after fix
            codeReview = await runCodeReview(client, config, issue, branch, worktreePath);
            log.info({ approved: codeReview.approved }, "code review re-run after fix");
          }
        }
      } catch (err: unknown) {
        log.warn({ err }, "code review failed — proceeding without review");
        codeReview = undefined;
      }
    }

    // Gather changed files
    filesChanged = await getChangedFiles(branch, config.baseBranch);

    // Final status: passed quality gate AND (no review OR review approved)
    status = qualityResult.passed ? "completed" : "failed";
  } finally {
    const duration_ms = Date.now() - startTime;

    // Step 11: Remove worktree (keeps branch for PR) — before huddle so we can report cleanup failures
    let cleanupWarning: string | undefined;
    try {
      await removeWorktree(worktreePath);
      log.info("worktree removed");
    } catch (err: unknown) {
      cleanupWarning = `⚠️ Orphaned worktree requires manual cleanup: \`${worktreePath}\``;
      log.error({ err, worktreePath }, "failed to remove worktree — orphaned worktree may need manual cleanup");
    }

    // Step 8: Huddle — format comment, post to issue, append to sprint log
    const huddleEntry: HuddleEntry = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      status,
      qualityResult,
      codeReview,
      duration_ms,
      filesChanged,
      timestamp: new Date(),
      cleanupWarning,
    };

    const comment = formatHuddleComment(huddleEntry);
    try {
      await addComment(issue.number, comment);
    } catch (err: unknown) {
      log.warn({ err, issueNumber: issue.number }, "failed to post huddle comment — non-critical");
    }

    const logEntry = formatSprintLogEntry(huddleEntry);
    appendToSprintLog(config.sprintNumber, logEntry, undefined, config.sprintSlug);

    // Step 9: Set final label
    const finalLabel = status === "completed" ? "status:done" : "status:blocked";
    try {
      await setLabel(issue.number, finalLabel);
      log.info({ status, finalLabel }, "final status set");
    } catch (err: unknown) {
      log.warn({ err, issueNumber: issue.number, finalLabel }, "failed to set final label — non-critical");
    }
  }

  const duration_ms = Date.now() - startTime;

  // Step 12: Return result
  return {
    issueNumber: issue.number,
    status,
    qualityGatePassed: qualityResult.passed,
    qualityDetails: qualityResult,
    codeReview,
    branch,
    duration_ms,
    filesChanged,
    retryCount,
    points: issue.points,
  };
}

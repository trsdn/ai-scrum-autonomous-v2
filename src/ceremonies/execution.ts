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
import { getPRStats } from "../git/merge.js";
import { substitutePrompt, extractJson, sanitizePromptInput } from "./helpers.js";
import { logger } from "../logger.js";
import type { SprintEventBus } from "../events.js";
import { handleQualityFailure, buildBranch, buildQualityGateConfig } from "./quality-retry.js";
import { sessionController } from "../dashboard/session-control.js";
import type { Logger } from "pino";

// Re-export for backward compatibility
export { handleQualityFailure } from "./quality-retry.js";

/** Shared context threaded through execution sub-phases. */
interface ExecutionContext {
  client: AcpClient;
  config: SprintConfig;
  issue: SprintIssue;
  eventBus?: SprintEventBus;
  log: Logger;
  branch: string;
  worktreePath: string;
  progress: (step: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-phase: Plan
// ---------------------------------------------------------------------------

/** Create ACP session, switch to Plan mode, generate and post implementation plan. */
async function planPhase(ctx: ExecutionContext, sessionId: string): Promise<string> {
  const { client, config, issue, log, progress } = ctx;
  const plannerConfig = await resolveSessionConfig(config, "planner");

  const promptVars = buildPromptVars(ctx);

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

    if (plannerConfig.instructions) {
      planPrompt = plannerConfig.instructions + "\n\n" + planPrompt;
    }

    const planResult = await client.sendPrompt(sessionId, planPrompt, config.sessionTimeoutMs);
    implementationPlan = planResult.response;

    try {
      const planJson = extractJson<{ summary: string; steps: unknown[] }>(implementationPlan);
      log.info(
        { summary: planJson.summary, stepCount: planJson.steps?.length ?? 0 },
        "implementation plan created",
      );
    } catch {
      log.info({ responseLength: implementationPlan.length }, "implementation plan created (unstructured)");
    }

    await addComment(
      issue.number,
      `### 📋 Implementation Plan — #${issue.number}\n\n${implementationPlan}`,
    );
    log.info("plan posted to issue");
  } catch (err: unknown) {
    log.warn({ err }, "plan mode failed — proceeding with direct execution");
  }

  return implementationPlan;
}

// ---------------------------------------------------------------------------
// Sub-phase: Implement
// ---------------------------------------------------------------------------

/** Switch to Agent mode, send worker prompt, handle interactive messages. */
async function implementPhase(ctx: ExecutionContext, sessionId: string, implementationPlan: string): Promise<void> {
  const { client, config, issue, eventBus, log, progress } = ctx;
  const workerConfig = await resolveSessionConfig(config, "worker");
  const promptVars = buildPromptVars(ctx);

  await client.setMode(sessionId, ACP_MODES.AGENT);
  if (workerConfig.model) {
    await client.setModel(sessionId, workerConfig.model);
  }
  log.info("switched to Agent mode");
  progress("implementing");

  const workerTemplatePath = path.join(config.projectPath, "prompts", "worker.md");
  const workerTemplate = await fs.readFile(workerTemplatePath, "utf-8");
  let workerPrompt = substitutePrompt(workerTemplate, promptVars);

  if (workerConfig.instructions) {
    workerPrompt = workerConfig.instructions + "\n\n" + workerPrompt;
  }

  if (implementationPlan) {
    workerPrompt += `\n\n## Implementation Plan (follow this)\n\n${implementationPlan}`;
  }

  await client.sendPrompt(sessionId, workerPrompt, config.sessionTimeoutMs);

  // Process queued interactive messages from dashboard
  while (sessionController.hasPending(sessionId) && !sessionController.shouldStop(sessionId)) {
    const messages = sessionController.drain(sessionId);
    for (const msg of messages) {
      if (msg.type === "user-message" && msg.content) {
        log.info({ sessionId }, "sending queued user message to session");
        eventBus?.emitTyped("worker:output", { sessionId, text: `\n\n---\n**User message:** ${msg.content}\n---\n\n` });
        await client.sendPrompt(sessionId, msg.content, config.sessionTimeoutMs);
      }
    }
  }

  if (sessionController.shouldStop(sessionId)) {
    log.warn({ sessionId, issue: issue.number }, "session stopped by user");
    eventBus?.emitTyped("worker:output", { sessionId, text: "\n\n⏹ Session stopped by user.\n" });
  }
  sessionController.cleanup(sessionId);
}

// ---------------------------------------------------------------------------
// Sub-phase: Quality gate + code review + challenger
// ---------------------------------------------------------------------------

interface ReviewOutcome {
  qualityResult: QualityResult;
  codeReview?: CodeReviewResult;
  retryCount: number;
}

/** Run quality gate, code review, and challenger review. */
async function qualityAndReviewPhase(ctx: ExecutionContext): Promise<ReviewOutcome> {
  const { client, config, issue, log, worktreePath, branch, progress } = ctx;

  progress("quality gate");
  const gateConfig = buildQualityGateConfig(config);
  gateConfig.expectedFiles = issue.expectedFiles;
  let qualityResult = await runQualityGate(gateConfig, worktreePath, branch, config.baseBranch);

  let retryCount = 0;
  if (!qualityResult.passed) {
    qualityResult = await handleQualityFailure(client, config, issue, worktreePath, qualityResult, 0, ctx.eventBus);
    retryCount = qualityResult.passed ? 0 : config.maxRetries;
  }

  let codeReview: CodeReviewResult | undefined;
  if (qualityResult.passed) {
    try {
      progress("code review");
      codeReview = await runCodeReview(client, config, issue, branch, worktreePath);
      log.info({ approved: codeReview.approved, issues: codeReview.issues.length }, "code review completed");

      if (!codeReview.approved) {
        const fixResult = await attemptCodeReviewFix(ctx, codeReview);
        qualityResult = fixResult.qualityResult;
        codeReview = fixResult.codeReview;
      }
    } catch (err: unknown) {
      log.warn({ err }, "code review failed — proceeding without review");
      codeReview = undefined;
    }
  }

  // Challenger review (advisory — doesn't block)
  if (qualityResult.passed && config.enableChallenger) {
    await runChallengerPhase(ctx);
  }

  return { qualityResult, codeReview, retryCount };
}

/** Attempt to fix code review issues and re-run gates. */
async function attemptCodeReviewFix(
  ctx: ExecutionContext,
  codeReview: CodeReviewResult,
): Promise<{ qualityResult: QualityResult; codeReview?: CodeReviewResult }> {
  const { client, config, issue, log, worktreePath, branch } = ctx;

  log.warn("code review rejected — attempting fix");
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

  const rerunGateConfig = buildQualityGateConfig(config);
  rerunGateConfig.expectedFiles = issue.expectedFiles;
  const newQuality = await runQualityGate(rerunGateConfig, worktreePath, branch, config.baseBranch);

  let newReview: CodeReviewResult | undefined = codeReview;
  if (newQuality.passed) {
    newReview = await runCodeReview(client, config, issue, branch, worktreePath);
    log.info({ approved: newReview.approved }, "code review re-run after fix");
  }

  return { qualityResult: newQuality, codeReview: newReview };
}

/** Run challenger review (advisory — posts comments but doesn't block). */
async function runChallengerPhase(ctx: ExecutionContext): Promise<void> {
  const { client, config, issue, log, branch, progress } = ctx;

  try {
    progress("challenger review");
    const { runChallengerReview } = await import("../enforcement/challenger.js");
    const challengerResult = await runChallengerReview(client, config, branch, issue.number);
    log.info({ approved: challengerResult.approved }, "challenger review completed");

    if (!challengerResult.approved) {
      log.warn({ feedback: challengerResult.feedback.slice(0, 200) }, "challenger rejected — marking as concern");
      await addComment(
        issue.number,
        `### 🔍 Challenger Review\n\n**Result:** ⚠️ Concerns raised\n\n${challengerResult.feedback}`,
      ).catch((err) => log.warn({ err: String(err) }, "failed to post challenger comment"));
    }
  } catch (err: unknown) {
    log.warn({ err }, "challenger review failed — proceeding without");
  }
}

// ---------------------------------------------------------------------------
// Sub-phase: Cleanup (worktree, huddle, labels)
// ---------------------------------------------------------------------------

interface CleanupInput {
  status: "completed" | "failed";
  qualityResult: QualityResult;
  codeReview?: CodeReviewResult;
  retryCount: number;
  filesChanged: string[];
  errorMessage?: string;
  startTime: number;
}

/** Remove worktree, post huddle, set final labels. */
async function cleanupPhase(ctx: ExecutionContext, input: CleanupInput): Promise<void> {
  const { config, issue, log, worktreePath, branch } = ctx;
  const duration_ms = Date.now() - input.startTime;

  // Remove worktree (keeps branch for PR)
  let cleanupWarning: string | undefined;
  try {
    await removeWorktree(worktreePath);
    log.info("worktree removed");
  } catch (err: unknown) {
    cleanupWarning = `⚠️ Orphaned worktree requires manual cleanup: \`${worktreePath}\``;
    log.error({ err, worktreePath }, "failed to remove worktree — orphaned worktree may need manual cleanup");
  }

  // Enrich with PR stats
  let prStats: HuddleEntry["prStats"];
  try {
    const stats = await getPRStats(branch);
    if (stats) {
      prStats = stats;
      if (input.filesChanged.length === 0 && stats.changedFiles > 0) {
        log.info({ prNumber: stats.prNumber, changedFiles: stats.changedFiles }, "PR has files — overriding local diff");
        input.filesChanged = [`(${stats.changedFiles} files via PR #${stats.prNumber})`];
      }
    }
  } catch {
    // Non-critical — proceed with local diff data
  }

  // Huddle — format comment, post to issue, append to sprint log
  const huddleEntry: HuddleEntry = {
    issueNumber: issue.number,
    issueTitle: issue.title,
    status: input.status,
    qualityResult: input.qualityResult,
    codeReview: input.codeReview,
    duration_ms,
    filesChanged: input.filesChanged,
    timestamp: new Date(),
    cleanupWarning,
    errorMessage: input.errorMessage,
    prStats,
    retryCount: input.retryCount,
  };

  const comment = formatHuddleComment(huddleEntry);
  try {
    await addComment(issue.number, comment);
  } catch (err: unknown) {
    log.warn({ err, issueNumber: issue.number }, "failed to post huddle comment — non-critical");
  }

  const logEntry = formatSprintLogEntry(huddleEntry);
  appendToSprintLog(config.sprintNumber, logEntry, undefined, config.sprintSlug);

  // Set final label
  const finalLabel = input.status === "completed" ? "status:done" : "status:blocked";
  try {
    await setLabel(issue.number, finalLabel);
    if (finalLabel === "status:blocked") {
      const blockReason = input.errorMessage
        ?? input.qualityResult?.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join("; ")
        ?? "Unknown reason";
      await addComment(issue.number, `**Block reason:** ${blockReason}`).catch((err) => log.warn({ err: String(err), issue: issue.number }, "failed to post block reason comment"));
    }
    log.info({ status: input.status, finalLabel }, "final status set");
  } catch (err: unknown) {
    log.warn({ err, issueNumber: issue.number, finalLabel }, "failed to set final label — non-critical");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPromptVars(ctx: ExecutionContext): Record<string, string> {
  const { config, issue, branch, worktreePath } = ctx;
  return {
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
    MAX_DIFF_LINES: String(buildQualityGateConfig(config).maxDiffLines),
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

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

  const ctx: ExecutionContext = { client, config, issue, eventBus, log, branch, worktreePath, progress };

  // Step 1: Set in-progress label
  await setLabel(issue.number, "status:in-progress");
  log.info("issue marked in-progress");
  progress("creating worktree");

  // Step 2: Create worktree
  await createWorktree({ path: worktreePath, branch, base: config.baseBranch });
  log.info({ worktreePath, branch }, "worktree created");

  let qualityResult: QualityResult = { passed: false, checks: [] };
  let codeReview: CodeReviewResult | undefined;
  let retryCount = 0;
  let filesChanged: string[] = [];
  let status: "completed" | "failed" = "failed";
  let errorMessage: string | undefined;

  try {
    // Step 3: Create ACP session
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
      // Step 4-5: Plan → Implement
      const implementationPlan = await planPhase(ctx, sessionId);
      await implementPhase(ctx, sessionId, implementationPlan);
    } finally {
      eventBus?.emitTyped("session:end", { sessionId });
      await client.endSession(sessionId);
    }

    // Step 6-8: Quality gate, code review, challenger
    const reviewOutcome = await qualityAndReviewPhase(ctx);
    qualityResult = reviewOutcome.qualityResult;
    codeReview = reviewOutcome.codeReview;
    retryCount = reviewOutcome.retryCount;

    // Gather changed files
    filesChanged = await getChangedFiles(branch, config.baseBranch);

    // Zero-change guard
    if (qualityResult.passed && filesChanged.length === 0) {
      log.warn({ issue: issue.number }, "Worker produced 0 file changes — treating as failure");
      status = "failed";
      qualityResult = {
        passed: false,
        checks: [
          ...qualityResult.checks,
          { name: "files-changed", passed: false, detail: "Worker produced 0 file changes", category: "other" as const },
        ],
      };
    } else {
      status = qualityResult.passed ? "completed" : "failed";
    }
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err: errorMessage, issue: issue.number }, "issue execution failed");
    status = "failed";
  } finally {
    // Step 9-11: Cleanup (worktree, huddle, labels)
    await cleanupPhase(ctx, { status, qualityResult, codeReview, retryCount, filesChanged, errorMessage, startTime });
  }

  const duration_ms = Date.now() - startTime;

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

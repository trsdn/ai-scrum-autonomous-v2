import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type {
  SprintConfig,
  SprintIssue,
  IssueResult,
  QualityResult,
  HuddleEntry,
} from "../types.js";
import { createWorktree, removeWorktree } from "../git/worktree.js";
import { runQualityGate } from "../enforcement/quality-gate.js";
import {
  formatHuddleComment,
  formatSprintLogEntry,
} from "../documentation/huddle.js";
import { appendToSprintLog } from "../documentation/sprint-log.js";
import { addComment } from "../github/issues.js";
import { setLabel } from "../github/labels.js";
import { getChangedFiles } from "../git/diff-analysis.js";
import { substitutePrompt } from "./helpers.js";
import { logger } from "../logger.js";

const DEFAULT_QUALITY_GATE_CONFIG = {
  requireTests: true,
  requireLint: true,
  requireTypes: true,
  maxDiffLines: 300,
  testCommand: "npm run test",
  lintCommand: "npm run lint",
  typecheckCommand: "npm run typecheck",
};

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

  const sessionId = await client.createSession({ cwd: worktreePath });
  try {
    await client.sendPrompt(sessionId, feedbackPrompt, config.sessionTimeoutMs);
  } finally {
    await client.endSession(sessionId);
  }

  const branch = `sprint/${config.sprintNumber}/issue-${issue.number}`;
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
): Promise<IssueResult> {
  const log = logger.child({ ceremony: "execution", issue: issue.number });
  const startTime = Date.now();

  const branch = `sprint/${config.sprintNumber}/issue-${issue.number}`;
  const worktreePath = path.join(config.worktreeBase, `issue-${issue.number}`);

  // Step 1: Set in-progress label
  await setLabel(issue.number, "status:in-progress");
  log.info("issue marked in-progress");

  // Step 2: Create worktree
  await createWorktree({
    path: worktreePath,
    branch,
    base: config.baseBranch,
  });
  log.info({ worktreePath, branch }, "worktree created");

  let qualityResult: QualityResult = { passed: false, checks: [] };
  let retryCount = 0;
  let filesChanged: string[] = [];
  let status: "completed" | "failed" = "failed";

  try {
    // Step 3: Create ACP session in worktree
    const sessionId = await client.createSession({ cwd: worktreePath });

    try {
      // Step 4: Read and substitute worker prompt
      const templatePath = path.join(config.projectPath, "prompts", "worker.md");
      const template = await fs.readFile(templatePath, "utf-8");

      const prompt = substitutePrompt(template, {
        PROJECT_NAME: path.basename(config.projectPath),
        REPO_OWNER: "",
        REPO_NAME: path.basename(config.projectPath),
        SPRINT_NUMBER: String(config.sprintNumber),
        ISSUE_NUMBER: String(issue.number),
        ISSUE_TITLE: issue.title,
        ISSUE_BODY: issue.acceptanceCriteria,
        BRANCH_NAME: branch,
        BASE_BRANCH: config.baseBranch,
        WORKTREE_PATH: worktreePath,
        MAX_DIFF_LINES: String(DEFAULT_QUALITY_GATE_CONFIG.maxDiffLines),
      });

      // Step 5: Send prompt to ACP
      await client.sendPrompt(sessionId, prompt, config.sessionTimeoutMs);
    } finally {
      // Step 10: End ACP session
      await client.endSession(sessionId);
    }

    // Step 6: Run quality gate
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
      );
      retryCount = qualityResult.passed ? 0 : config.maxRetries;
    }

    // Gather changed files
    filesChanged = await getChangedFiles(branch, config.baseBranch);

    status = qualityResult.passed ? "completed" : "failed";
  } finally {
    const duration_ms = Date.now() - startTime;

    // Step 8: Huddle — format comment, post to issue, append to sprint log
    const huddleEntry: HuddleEntry = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      status,
      qualityResult,
      duration_ms,
      filesChanged,
      timestamp: new Date(),
    };

    const comment = formatHuddleComment(huddleEntry);
    await addComment(issue.number, comment);

    const logEntry = formatSprintLogEntry(huddleEntry);
    appendToSprintLog(config.sprintNumber, logEntry);

    // Step 9: Set final label
    const finalLabel = status === "completed" ? "status:done" : "status:blocked";
    await setLabel(issue.number, finalLabel);
    log.info({ status, finalLabel }, "final status set");

    // Step 11: Remove worktree (keeps branch for PR)
    try {
      await removeWorktree(worktreePath);
      log.info("worktree removed");
    } catch (err) {
      log.warn({ err }, "failed to remove worktree");
    }
  }

  const duration_ms = Date.now() - startTime;

  // Step 12: Return result
  return {
    issueNumber: issue.number,
    status,
    qualityGatePassed: qualityResult.passed,
    qualityDetails: qualityResult,
    branch,
    duration_ms,
    filesChanged,
    retryCount,
    points: issue.points,
  };
}

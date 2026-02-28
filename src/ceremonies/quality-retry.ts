import type { AcpClient } from "../acp/client.js";
import { resolveSessionConfig } from "../acp/session-config.js";
import type {
  SprintConfig,
  SprintIssue,
  QualityResult,
} from "../types.js";
import { runQualityGate } from "../enforcement/quality-gate.js";
import { logger } from "../logger.js";
import type { SprintEventBus } from "../events.js";

export const DEFAULT_QUALITY_GATE_CONFIG = {
  requireTests: true,
  requireLint: true,
  requireTypes: true,
  maxDiffLines: 300,
  testCommand: ["npm", "run", "test"],
  lintCommand: ["npm", "run", "lint"],
  typecheckCommand: ["npm", "run", "typecheck"],
};

/** Build branch name from config pattern. */
export function buildBranch(config: SprintConfig, issueNumber: number): string {
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

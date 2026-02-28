import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type { SprintConfig, SprintResult, ReviewResult } from "../types.js";
import type { SprintEventBus } from "../events.js";
import { calculateSprintMetrics, topFailedGates } from "../metrics.js";
import { readVelocity } from "../documentation/velocity.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson, sanitizePromptInput } from "./helpers.js";
import { resolveSessionConfig } from "../acp/session-config.js";

/**
 * Run the sprint review ceremony: calculate metrics, ask ACP for a
 * stakeholder-facing summary, and return the review result.
 */
export async function runSprintReview(
  client: AcpClient,
  config: SprintConfig,
  result: SprintResult,
  eventBus?: SprintEventBus,
): Promise<ReviewResult> {
  const log = logger.child({ ceremony: "review" });

  // Calculate metrics
  const metrics = calculateSprintMetrics(result);
  const failedGates = topFailedGates(result);
  log.info({ metrics }, "Calculated sprint metrics");

  // Read velocity data
  const velocity = readVelocity();
  const velocityStr = JSON.stringify(velocity);

  // Build sprint issues summary
  const issuesSummary = result.results.map((r) => ({
    number: r.issueNumber,
    status: r.status,
    points: r.points,
    branch: r.branch,
    duration_ms: r.duration_ms,
    filesChanged: r.filesChanged,
    retryCount: r.retryCount,
    qualityGatePassed: r.qualityGatePassed,
    qualityChecks: r.qualityDetails?.checks?.map((c) => ({
      name: c.name,
      passed: c.passed,
      category: c.category,
    })) ?? [],
    codeReviewApproved: r.codeReview?.approved,
    codeReviewIssues: r.codeReview?.issues?.length ?? 0,
  }));

  // Read prompt template
  const templatePath = path.join(config.projectPath, "prompts", "review.md");
  const template = await fs.readFile(templatePath, "utf-8");

  const prompt = substitutePrompt(template, {
    PROJECT_NAME: path.basename(config.projectPath),
    REPO_OWNER: "",
    REPO_NAME: path.basename(config.projectPath),
    SPRINT_NUMBER: String(config.sprintNumber),
    SPRINT_START_SHA: config.baseBranch,
    SPRINT_ISSUES: sanitizePromptInput(JSON.stringify(issuesSummary)),
    VELOCITY_DATA: sanitizePromptInput(velocityStr),
    BASE_BRANCH: config.baseBranch,
    METRICS: JSON.stringify(metrics),
    FAILED_GATES: failedGates,
  });

  // Create ACP session and send prompt
  const sessionConfig = await resolveSessionConfig(config, "review");
  const { sessionId } = await client.createSession({
    cwd: config.projectPath,
    mcpServers: sessionConfig.mcpServers,
  });
  eventBus?.emitTyped("session:start", { sessionId, role: "review" });
  try {
    let fullPrompt = prompt;
    if (sessionConfig.instructions) {
      fullPrompt = sessionConfig.instructions + "\n\n" + fullPrompt;
    }
    if (sessionConfig.model) {
      await client.setModel(sessionId, sessionConfig.model);
    }
    const response = await client.sendPrompt(sessionId, fullPrompt, config.sessionTimeoutMs);
    const review = extractJson<ReviewResult>(response.response);

    // Ensure arrays exist (model may omit them)
    review.demoItems = review.demoItems ?? [];
    review.openItems = review.openItems ?? [];

    log.info(
      { demoItems: review.demoItems.length, openItems: review.openItems.length },
      "Sprint review completed",
    );

    return review;
  } finally {
    await client.endSession(sessionId);
    eventBus?.emitTyped("session:end", { sessionId });
  }
}

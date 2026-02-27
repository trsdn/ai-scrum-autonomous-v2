import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type { SprintConfig, SprintResult, ReviewResult } from "../types.js";
import { calculateSprintMetrics, topFailedGates } from "../metrics.js";
import { readVelocity } from "../documentation/velocity.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson } from "./helpers.js";
import { resolveSessionConfig } from "../acp/session-config.js";

/**
 * Run the sprint review ceremony: calculate metrics, ask ACP for a
 * stakeholder-facing summary, and return the review result.
 */
export async function runSprintReview(
  client: AcpClient,
  config: SprintConfig,
  result: SprintResult,
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
    SPRINT_ISSUES: JSON.stringify(issuesSummary),
    VELOCITY_DATA: velocityStr,
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
  }
}

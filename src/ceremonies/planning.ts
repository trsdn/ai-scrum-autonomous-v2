import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type { SprintConfig, SprintPlan, RefinedIssue } from "../types.js";
import { listIssues } from "../github/issues.js";
import { setLabel } from "../github/labels.js";
import { setMilestone, getMilestone, createMilestone } from "../github/milestones.js";
import { createSprintLog } from "../documentation/sprint-log.js";
import { readVelocity } from "../documentation/velocity.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson } from "./helpers.js";

/**
 * Run the sprint planning ceremony: select and sequence backlog issues
 * into a sprint plan via ACP, then label and milestone them.
 */
export async function runSprintPlanning(
  client: AcpClient,
  config: SprintConfig,
  refinedIssues?: RefinedIssue[],
): Promise<SprintPlan> {
  const log = logger.child({ ceremony: "planning" });

  // Read velocity data
  const velocity = readVelocity();
  const velocityStr = JSON.stringify(velocity);

  // List available backlog issues
  const backlog = await listIssues({ state: "open" });
  log.info({ count: backlog.length }, "Loaded backlog issues");

  // Read prompt template
  const templatePath = path.join(config.projectPath, "prompts", "planning.md");
  const template = await fs.readFile(templatePath, "utf-8");

  const prompt = substitutePrompt(template, {
    PROJECT_NAME: path.basename(config.projectPath),
    REPO_OWNER: "",
    REPO_NAME: path.basename(config.projectPath),
    SPRINT_NUMBER: String(config.sprintNumber),
    MAX_ISSUES: String(config.maxIssuesPerSprint),
    VELOCITY_DATA: velocityStr,
    PREVIOUS_SPRINT_SUMMARY: refinedIssues
      ? JSON.stringify(refinedIssues)
      : "No previous refinement data",
    BASE_BRANCH: config.baseBranch,
  });

  // Create ACP session and send prompt
  const sessionId = await client.createSession({ cwd: config.projectPath });
  try {
    const result = await client.sendPrompt(sessionId, prompt, config.sessionTimeoutMs);
    const plan = extractJson<SprintPlan>(result.response);

    log.info(
      {
        sprintNumber: plan.sprintNumber,
        issueCount: plan.sprint_issues.length,
        estimatedPoints: plan.estimated_points,
      },
      "Sprint plan created",
    );

    // Ensure milestone exists
    const milestoneTitle = `Sprint ${config.sprintNumber}`;
    const existing = await getMilestone(milestoneTitle);
    if (!existing) {
      await createMilestone(milestoneTitle, `Sprint ${config.sprintNumber} milestone`);
    }

    // Set labels and milestone on each selected issue
    for (const issue of plan.sprint_issues) {
      await setLabel(issue.number, "status:planned");
      await setMilestone(issue.number, milestoneTitle);
      log.debug({ issue: issue.number }, "Labeled and milestoned issue");
    }

    // Update sprint log
    createSprintLog(
      config.sprintNumber,
      plan.rationale,
      plan.sprint_issues.length,
    );

    return plan;
  } finally {
    await client.endSession(sessionId);
  }
}

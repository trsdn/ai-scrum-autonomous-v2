import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type { SprintConfig, SprintPlan, RefinedIssue } from "../types.js";
import type { SprintEventBus } from "../tui/events.js";
import { listIssues } from "../github/issues.js";
import { setLabel } from "../github/labels.js";
import { setMilestone, getMilestone, createMilestone } from "../github/milestones.js";
import { createSprintLog } from "../documentation/sprint-log.js";
import { readVelocity } from "../documentation/velocity.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson } from "./helpers.js";
import { resolveSessionConfig } from "../acp/session-config.js";

/**
 * Run the sprint planning ceremony: select and sequence backlog issues
 * into a sprint plan via ACP, then label and milestone them.
 */
export async function runSprintPlanning(
  client: AcpClient,
  config: SprintConfig,
  refinedIssues?: RefinedIssue[],
  eventBus?: SprintEventBus,
): Promise<SprintPlan> {
  const log = logger.child({ ceremony: "planning" });

  // Read velocity data
  const velocity = readVelocity();
  const velocityStr = JSON.stringify(velocity);

  // List available backlog issues (filtered by backlog_labels if configured)
  const listOpts: { state: string; labels?: string[] } = { state: "open" };
  if (config.backlogLabels.length > 0) {
    listOpts.labels = config.backlogLabels;
  }
  const backlog = await listIssues(listOpts);
  log.info({ count: backlog.length, labels: config.backlogLabels }, "Loaded backlog issues");

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
  const sessionConfig = await resolveSessionConfig(config, "planning");
  const { sessionId } = await client.createSession({
    cwd: config.projectPath,
    mcpServers: sessionConfig.mcpServers,
  });
  eventBus?.emitTyped("session:start", { sessionId, role: "planning" });
  try {
    let fullPrompt = prompt;
    if (sessionConfig.instructions) {
      fullPrompt = sessionConfig.instructions + "\n\n" + fullPrompt;
    }
    if (sessionConfig.model) {
      await client.setModel(sessionId, sessionConfig.model);
    }
    const result = await client.sendPrompt(sessionId, fullPrompt, config.sessionTimeoutMs);
    const plan = extractJson<SprintPlan>(result.response);

    if (!plan.sprint_issues || !Array.isArray(plan.sprint_issues)) {
      throw new Error("Invalid sprint plan: missing or invalid sprint_issues array");
    }

    log.info(
      {
        sprintNumber: plan.sprintNumber,
        issueCount: plan.sprint_issues.length,
        estimatedPoints: plan.estimated_points,
      },
      "Sprint plan created",
    );

    // Ensure milestone exists
    const milestoneTitle = `${config.sprintPrefix} ${config.sprintNumber}`;
    const existing = await getMilestone(milestoneTitle);
    if (!existing) {
      await createMilestone(milestoneTitle, `${config.sprintPrefix} ${config.sprintNumber} milestone`);
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
      undefined,
      config.sprintPrefix,
      config.sprintSlug,
    );

    return plan;
  } finally {
    await client.endSession(sessionId);
    eventBus?.emitTyped("session:end", { sessionId });
  }
}

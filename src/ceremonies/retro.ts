import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type {
  SprintConfig,
  SprintResult,
  ReviewResult,
  RetroResult,
  RetroImprovement,
} from "../types.js";
import type { SprintEventBus } from "../events.js";
import { calculateSprintMetrics } from "../metrics.js";
import { readVelocity } from "../documentation/velocity.js";
import { createIssueRateLimited, type IssueCreationState } from "../github/issue-rate-limiter.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson, sanitizePromptInput } from "./helpers.js";
import { resolveSessionConfig } from "../acp/session-config.js";

/**
 * Run the sprint retro ceremony: analyse sprint data, ask ACP for
 * improvements, and create GitHub issues for non-auto-applicable items.
 */
export async function runSprintRetro(
  client: AcpClient,
  config: SprintConfig,
  result: SprintResult,
  review: ReviewResult,
  eventBus?: SprintEventBus,
  state: IssueCreationState = { issuesCreatedCount: 0 },
): Promise<RetroResult> {
  const log = logger.child({ ceremony: "retro" });

  // Calculate metrics
  const metrics = calculateSprintMetrics(result);

  // Read velocity data
  const velocity = readVelocity();
  const velocityStr = JSON.stringify(velocity);

  // Load previous retro improvements (best-effort)
  let previousImprovements = "None available";
  const prevRetroPath = path.join(
    config.projectPath,
    "docs",
    "sprints",
    `sprint-${config.sprintNumber - 1}-retro.md`,
  );
  try {
    previousImprovements = await fs.readFile(prevRetroPath, "utf-8");
  } catch {
    log.debug("No previous retro file found — using empty context");
  }

  // Read sprint runner config for context (filtered to sprint-relevant keys)
  let runnerConfig = "";
  const configPath = path.join(config.projectPath, "sprint-runner.config.yaml");
  try {
    const rawConfig = await fs.readFile(configPath, "utf-8");
    // Filter to sprint-relevant keys only
    const lines = rawConfig.split("\n");
    const relevantKeys = ["sprintPrefix", "qualityGate", "maxParallel", "sessionTimeout", "backlogLabels", "maxRetries"];
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) return true;
      return relevantKeys.some(key => trimmed.startsWith(key));
    });
    runnerConfig = filteredLines.join("\n");
  } catch {
    log.debug("No sprint runner config found");
  }

  // Read prompt template
  const templatePath = path.join(config.projectPath, ".aiscrum", "roles", "retro", "prompts", "retro.md");
  const template = await fs.readFile(templatePath, "utf-8");

  const prompt = substitutePrompt(template, {
    PROJECT_NAME: path.basename(config.projectPath),
    REPO_OWNER: "",
    REPO_NAME: path.basename(config.projectPath),
    SPRINT_NUMBER: String(config.sprintNumber),
    SPRINT_REVIEW_DATA: sanitizePromptInput(JSON.stringify({ review, metrics })),
    VELOCITY_DATA: velocityStr,
    PREVIOUS_RETRO_IMPROVEMENTS: sanitizePromptInput(previousImprovements),
    SPRINT_RUNNER_CONFIG: runnerConfig,
  });

  // Create ACP session and send prompt
  const sessionConfig = await resolveSessionConfig(config, "retro");
  const { sessionId } = await client.createSession({
    cwd: config.projectPath,
    mcpServers: sessionConfig.mcpServers,
  });
  eventBus?.emitTyped("session:start", { sessionId, role: "retro" });
  try {
    let fullPrompt = prompt;
    if (sessionConfig.instructions) {
      fullPrompt = sessionConfig.instructions + "\n\n" + fullPrompt;
    }
    if (sessionConfig.model) {
      await client.setModel(sessionId, sessionConfig.model);
    }
    const response = await client.sendPrompt(sessionId, fullPrompt, config.sessionTimeoutMs);
    const retro = extractJson<RetroResult>(response.response);

    // Ensure arrays exist (model may omit them)
    retro.wentWell = retro.wentWell ?? [];
    retro.wentBadly = retro.wentBadly ?? [];
    retro.improvements = retro.improvements ?? [];

    log.info(
      {
        wentWell: retro.wentWell.length,
        wentBadly: retro.wentBadly.length,
        improvements: retro.improvements.length,
      },
      "Sprint retro completed",
    );

    // Process improvements: auto-apply or create issues
    for (const improvement of retro.improvements) {
      const title = improvement.title;
      const description = improvement.description;
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        log.warn({ improvement }, "Skipping improvement with missing or empty title");
        continue;
      }
      if (!description || typeof description !== "string" || description.trim().length === 0) {
        log.warn({ title }, "Skipping improvement with missing or empty description");
        continue;
      }

      if (improvement.autoApplicable && (improvement.target === "skill" || improvement.target === "agent")) {
        // Auto-apply skill/agent improvements via ACP session
        await applySkillImprovement(client, config, improvement, eventBus);
        log.info({ title, target: improvement.target }, "Auto-applied improvement");
      } else if (improvement.autoApplicable && improvement.target === "config") {
        // Config changes create an issue for stakeholder review (safety)
        const issue = await createIssueRateLimited(
          {
            title: `chore(config): ${title}`,
            body: `**Auto-suggested config change:**\n\n${description}\n\n_This change was identified by the sprint retro as auto-applicable but requires stakeholder review._`,
            labels: ["type:chore", "scope:config", "needs:review"],
          },
          state,
          config.maxIssuesCreatedPerSprint ?? 10,
        );
        if (issue) {
          log.info({ title, number: issue.number }, "Created config improvement issue for review");
        }
      } else {
        // Non-auto-applicable or process improvements → create issue
        const issue = await createIssueRateLimited(
          {
            title: `chore(process): ${title}`,
            body: description,
            labels: ["type:chore", "scope:process"],
          },
          state,
          config.maxIssuesCreatedPerSprint ?? 10,
        );
        if (issue) {
          log.info({ title, number: issue.number }, "Created improvement issue");
        } else {
          log.warn({ title }, "Skipped improvement issue due to rate limit");
        }
      }
    }

    return retro;
  } finally {
    await client.endSession(sessionId);
    eventBus?.emitTyped("session:end", { sessionId });
  }
}

/**
 * Auto-apply a skill/agent improvement by sending the improvement description
 * to an ACP session that can edit the relevant files in .aiscrum/roles/.
 */
async function applySkillImprovement(
  client: AcpClient,
  config: SprintConfig,
  improvement: RetroImprovement,
  eventBus?: SprintEventBus,
): Promise<void> {
  const log = logger.child({ ceremony: "retro", target: improvement.target });
  const sessionConfig = await resolveSessionConfig(config, "worker");
  const { sessionId } = await client.createSession({
    cwd: config.projectPath,
    mcpServers: sessionConfig.mcpServers,
  });
  eventBus?.emitTyped("session:start", { sessionId, role: "retro-apply" });
  try {
    if (sessionConfig.model) {
      await client.setModel(sessionId, sessionConfig.model);
    }
    const prompt = [
      `## Apply Retro Improvement`,
      "",
      `**Title:** ${improvement.title}`,
      `**Target:** ${improvement.target}`,
      `**Description:** ${improvement.description}`,
      "",
      `Apply this improvement by editing the appropriate files under \`.aiscrum/roles/\`.`,
      `Look at the existing files to understand the structure, then make minimal targeted changes.`,
      `Do NOT create new files — only edit existing ones.`,
    ].join("\n");
    await client.sendPrompt(sessionId, prompt, config.sessionTimeoutMs);
    log.info({ title: improvement.title }, "Applied skill/agent improvement via ACP");
  } catch (err: unknown) {
    log.warn({ err: String(err), title: improvement.title }, "Failed to auto-apply improvement");
  } finally {
    eventBus?.emitTyped("session:end", { sessionId });
    await client.endSession(sessionId);
  }
}

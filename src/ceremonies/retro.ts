import fs from "node:fs/promises";
import path from "node:path";
import type { AcpClient } from "../acp/client.js";
import type {
  SprintConfig,
  SprintResult,
  ReviewResult,
  RetroResult,
} from "../types.js";
import type { SprintEventBus } from "../tui/events.js";
import { calculateSprintMetrics } from "../metrics.js";
import { readVelocity } from "../documentation/velocity.js";
import { createIssue } from "../github/issues.js";
import { logger } from "../logger.js";
import { substitutePrompt, extractJson } from "./helpers.js";
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

  // Read sprint runner config for context
  let runnerConfig = "";
  const configPath = path.join(config.projectPath, "sprint-runner.config.yaml");
  try {
    runnerConfig = await fs.readFile(configPath, "utf-8");
  } catch {
    log.debug("No sprint runner config found");
  }

  // Read prompt template
  const templatePath = path.join(config.projectPath, "prompts", "retro.md");
  const template = await fs.readFile(templatePath, "utf-8");

  const prompt = substitutePrompt(template, {
    PROJECT_NAME: path.basename(config.projectPath),
    REPO_OWNER: "",
    REPO_NAME: path.basename(config.projectPath),
    SPRINT_NUMBER: String(config.sprintNumber),
    SPRINT_REVIEW_DATA: JSON.stringify({ review, metrics }),
    VELOCITY_DATA: velocityStr,
    PREVIOUS_RETRO_IMPROVEMENTS: previousImprovements,
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

    // Create improvement issues for non-auto-applicable items
    for (const improvement of retro.improvements) {
      if (!improvement.autoApplicable) {
        // Validate fields before creating issue (ACP may return undefined fields)
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
        await createIssue({
          title: `chore(process): ${title}`,
          body: description,
          labels: ["type:chore", "scope:process"],
        });
        log.info({ title }, "Created improvement issue");
      }
    }

    return retro;
  } finally {
    await client.endSession(sessionId);
    eventBus?.emitTyped("session:end", { sessionId });
  }
}

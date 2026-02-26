import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createIssue } from "../github/issues.js";
import { logger } from "../logger.js";
import type { EscalationEvent } from "../types.js";

const execFile = promisify(execFileCb);

const MAX_HTTP_STRING_LENGTH = 500;

/** Sanitize a string for safe use in HTTP headers/body via curl. */
export function sanitizeForHttp(str: string): string {
  return str
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, MAX_HTTP_STRING_LENGTH);
}

export interface EscalationConfig {
  ntfyTopic?: string;
  ntfyEnabled: boolean;
}

export async function escalateToStakeholder(
  event: EscalationEvent,
  config: EscalationConfig,
): Promise<void> {
  const log = logger.child({ module: "escalation" });

  log.warn(
    { level: event.level, reason: event.reason, issueNumber: event.issueNumber },
    "escalation triggered",
  );

  // Create GitHub issue for escalation
  const issueRef = event.issueNumber ? ` (issue #${event.issueNumber})` : "";
  await createIssue({
    title: `🚨 Escalation [${event.level}]: ${event.reason}`,
    body: [
      `## Escalation${issueRef}`,
      "",
      `**Level:** ${event.level}`,
      `**Reason:** ${event.reason}`,
      `**Timestamp:** ${event.timestamp.toISOString()}`,
      "",
      "### Detail",
      "",
      event.detail,
      "",
      "### Context",
      "",
      "```json",
      JSON.stringify(event.context, null, 2),
      "```",
    ].join("\n"),
    labels: ["type:escalation", `priority:${event.level}`],
  });

  log.info("escalation issue created");

  // Send ntfy notification if configured
  if (config.ntfyEnabled && config.ntfyTopic) {
    try {
      await execFile("curl", [
        "-s",
        "-o",
        "/dev/null",
        "-d",
        `[${event.level}] ${sanitizeForHttp(event.reason)}: ${sanitizeForHttp(event.detail)}`,
        "-H",
        `Title: Escalation: ${sanitizeForHttp(event.reason)}`,
        "-H",
        `Priority: ${event.level === "must" ? "urgent" : event.level === "should" ? "high" : "default"}`,
        `https://ntfy.sh/${config.ntfyTopic}`,
      ]);
      log.info({ topic: config.ntfyTopic }, "ntfy notification sent");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, "ntfy notification failed");
    }
  }
}

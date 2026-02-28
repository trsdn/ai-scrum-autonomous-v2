/**
 * Session Logger — writes chat session transcripts to role log directories.
 *
 * Logs are stored per-role, per-sprint:
 *   .aiscrum/roles/<role>/log/sprint-<N>/<timestamp>-chat.md
 *
 * These logs are read by the retro agent to improve agent instructions.
 * They are excluded from agent context loading (loadRoleContext skips log/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatSession } from "./chat-manager.js";
import { logger } from "../logger.js";

const log = logger.child({ component: "session-logger" });

export interface SessionLogOptions {
  projectPath: string;
  sprintNumber: number;
}

/**
 * Write a chat session transcript to the role's log directory.
 * Creates directories as needed. Silently returns on error (non-critical).
 */
export function writeSessionLog(
  session: ChatSession,
  options: SessionLogOptions,
): void {
  try {
    if (session.messages.length === 0) {
      log.debug({ sessionId: session.id }, "Skipping empty session log");
      return;
    }

    const logDir = path.join(
      options.projectPath,
      ".aiscrum",
      "roles",
      session.role,
      "log",
      `sprint-${options.sprintNumber}`,
    );

    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = session.createdAt.toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}-chat.md`;
    const filepath = path.join(logDir, filename);

    const content = formatSessionLog(session);
    fs.writeFileSync(filepath, content, "utf-8");

    log.info(
      { sessionId: session.id, role: session.role, filepath },
      "Session log written",
    );
  } catch (err: unknown) {
    log.warn({ err, sessionId: session.id }, "Failed to write session log");
  }
}

function formatSessionLog(session: ChatSession): string {
  const lines: string[] = [];

  lines.push(`# Chat Session: ${session.role}`);
  lines.push("");
  lines.push(`- **Session ID**: ${session.id}`);
  lines.push(`- **Role**: ${session.role}`);
  lines.push(`- **Model**: ${session.model}`);
  lines.push(`- **Started**: ${session.createdAt.toISOString()}`);
  lines.push(`- **Messages**: ${session.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of session.messages) {
    const icon = msg.role === "user" ? "👤 User" : "🤖 Assistant";
    lines.push(`## ${icon}`);
    lines.push(`*${msg.timestamp.toISOString()}*`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

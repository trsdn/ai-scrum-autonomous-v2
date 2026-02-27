// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
import pino from "pino";
import type { Logger, DestinationStream } from "pino";
import * as fs from "node:fs";
import * as path from "node:path";

export type { Logger };

/**
 * Configuration options for creating a pino logger instance.
 *
 * @property level - Log severity threshold. Messages below this level are suppressed.
 * @property name - Logger name included in every log entry.
 * @property pretty - Enable pino-pretty for human-readable output. Defaults to true in non-production.
 */
export interface LoggerOptions {
  level?: "debug" | "info" | "warn" | "error";
  name?: string;
  pretty?: boolean;
}

/**
 * Contextual metadata attached to child loggers for sprint-scoped logging.
 *
 * @property sprint - Sprint number.
 * @property issue - Issue number being worked on.
 * @property ceremony - Active ceremony name (e.g., "planning", "review").
 */
export interface SprintContext {
  sprint?: number;
  issue?: number;
  ceremony?: string;
}

let logDestination: DestinationStream | undefined;

/**
 * Redirect all logger output to a file. Call this before rendering the TUI
 * so pino doesn't corrupt Ink's terminal output.
 */
export function redirectLogToFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  logDestination = pino.destination({ dest: filePath, sync: false });
  // Recreate the default logger with the new destination
  const opts = {
    name: logger.bindings().name ?? "sprint-runner",
    level: logger.level,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.secret",
        "*.apiKey",
        "*.authorization",
      ],
      censor: "[REDACTED]",
    },
  };
  const newLogger = pino(opts, logDestination);
  // Copy child loggers will inherit the new destination via the parent
  Object.assign(logger, newLogger);
}

/**
 * Create a new pino logger with the given options.
 *
 * Sensitive fields (password, token, secret, apiKey, authorization) are
 * automatically redacted. If {@link redirectLogToFile} was called, the
 * logger writes to the file destination instead of stdout.
 *
 * @param options - Logger configuration. Defaults to info level with pretty output in non-production.
 * @returns A configured pino Logger instance.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = "info",
    name = "sprint-runner",
    pretty = process.env["NODE_ENV"] !== "production",
  } = options;

  const transport = !logDestination && pretty
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined;

  const pinoOptions = {
    name,
    level,
    transport,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.secret",
        "*.apiKey",
        "*.authorization",
      ],
      censor: "[REDACTED]",
    },
  };

  return logDestination ? pino(pinoOptions, logDestination) : pino(pinoOptions);
}

/** Default logger instance for convenience. */
export const logger = createLogger();

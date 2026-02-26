import pino from "pino";
import type { Logger, DestinationStream } from "pino";
import * as fs from "node:fs";
import * as path from "node:path";

export type { Logger };

export interface LoggerOptions {
  level?: "debug" | "info" | "warn" | "error";
  name?: string;
  pretty?: boolean;
}

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

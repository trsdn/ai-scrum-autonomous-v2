import pino from "pino";
import type { Logger } from "pino";

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

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = "info",
    name = "sprint-runner",
    pretty = process.env["NODE_ENV"] !== "production",
  } = options;

  const transport = pretty
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined;

  return pino({
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
  });
}

/** Default logger instance for convenience. */
export const logger = createLogger();

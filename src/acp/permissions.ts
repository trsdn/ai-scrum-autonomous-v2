// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { Logger } from "../logger.js";
import { logger as defaultLogger } from "../logger.js";

export interface PermissionConfig {
  /** Auto-approve all permission requests when true. */
  autoApprove: boolean;
  /** Glob-like patterns for tool names to allow (matched via simple substring). */
  allowPatterns: string[];
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  autoApprove: false,
  allowPatterns: [],
};

/**
 * Creates a permission handler callback for the ACP client.
 * Returns a function compatible with `Client.requestPermission`.
 */
export function createPermissionHandler(
  config: PermissionConfig = DEFAULT_PERMISSION_CONFIG,
  log: Logger = defaultLogger,
): (params: RequestPermissionRequest) => Promise<RequestPermissionResponse> {
  return async (
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> => {
    const toolCall = params.toolCall;
    const toolName =
      toolCall && "name" in toolCall ? (toolCall.name as string) : "unknown";
    const options = params.options;

    // Find the allow_once option (preferred) or first allow option
    const allowOption =
      options.find((o) => o.kind === "allow_once") ??
      options.find((o) => o.kind === "allow_always");

    const rejectOption =
      options.find((o) => o.kind === "reject_once") ??
      options.find((o) => o.kind === "reject_always");

    if (config.autoApprove && allowOption) {
      log.debug({ tool: toolName, optionId: allowOption.optionId }, "permission auto-approved");
      return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
    }

    // Check allow patterns
    if (config.allowPatterns.length > 0 && allowOption) {
      const matched = config.allowPatterns.some((pattern) =>
        toolName.includes(pattern),
      );
      if (matched) {
        log.debug(
          { tool: toolName, optionId: allowOption.optionId },
          "permission approved via pattern match",
        );
        return { outcome: { outcome: "selected", optionId: allowOption.optionId } };
      }
    }

    // Reject if no auto-approve and no pattern match
    if (rejectOption) {
      log.warn(
        { tool: toolName, optionId: rejectOption.optionId },
        "permission rejected",
      );
      return { outcome: { outcome: "selected", optionId: rejectOption.optionId } };
    }

    // Fallback: cancel if no suitable option found
    log.warn({ tool: toolName }, "permission cancelled — no suitable option");
    return { outcome: { outcome: "cancelled" } };
  };
}

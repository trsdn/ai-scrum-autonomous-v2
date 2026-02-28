import { describe, it, expect, vi } from "vitest";
import {
  createPermissionHandler,
  DEFAULT_PERMISSION_CONFIG,
  type PermissionConfig,
} from "../../src/acp/permissions.js";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

/** Helper to build a minimal RequestPermissionRequest. */
function makeRequest(
  toolName: string,
  options: RequestPermissionRequest["options"] = [
    { kind: "allow_once", optionId: "allow-1" },
    { kind: "reject_once", optionId: "reject-1" },
  ],
): RequestPermissionRequest {
  return {
    toolCall: { name: toolName },
    options,
  } as RequestPermissionRequest;
}

const silentLog = {
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
} as never;

describe("createPermissionHandler", () => {
  describe("auto-approve", () => {
    it("approves when autoApprove is true", async () => {
      const handler = createPermissionHandler(
        { autoApprove: true, allowPatterns: [] },
        silentLog,
      );
      const result = await handler(makeRequest("some_tool"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-1",
      });
    });

    it("prefers allow_once over allow_always", async () => {
      const handler = createPermissionHandler(
        { autoApprove: true, allowPatterns: [] },
        silentLog,
      );
      const result = await handler(
        makeRequest("tool", [
          { kind: "allow_always", optionId: "always-1" },
          { kind: "allow_once", optionId: "once-1" },
        ]),
      );
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "once-1",
      });
    });

    it("falls back to allow_always when no allow_once", async () => {
      const handler = createPermissionHandler(
        { autoApprove: true, allowPatterns: [] },
        silentLog,
      );
      const result = await handler(
        makeRequest("tool", [
          { kind: "allow_always", optionId: "always-1" },
          { kind: "reject_once", optionId: "reject-1" },
        ]),
      );
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "always-1",
      });
    });
  });

  describe("allow pattern matching", () => {
    it("approves tool matching a pattern", async () => {
      const config: PermissionConfig = {
        autoApprove: false,
        allowPatterns: ["read_file", "write"],
      };
      const handler = createPermissionHandler(config, silentLog);

      const result = await handler(makeRequest("read_file"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-1",
      });
    });

    it("approves when tool name contains pattern substring", async () => {
      const config: PermissionConfig = {
        autoApprove: false,
        allowPatterns: ["file"],
      };
      const handler = createPermissionHandler(config, silentLog);

      const result = await handler(makeRequest("read_file_contents"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-1",
      });
    });

    it("rejects tool not matching any pattern", async () => {
      const config: PermissionConfig = {
        autoApprove: false,
        allowPatterns: ["read_file"],
      };
      const handler = createPermissionHandler(config, silentLog);

      const result = await handler(makeRequest("execute_command"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject-1",
      });
    });
  });

  describe("rejection", () => {
    it("rejects when autoApprove is false and no patterns match", async () => {
      const handler = createPermissionHandler(
        DEFAULT_PERMISSION_CONFIG,
        silentLog,
      );
      const result = await handler(makeRequest("dangerous_tool"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject-1",
      });
    });

    it("prefers reject_once over reject_always", async () => {
      const handler = createPermissionHandler(
        DEFAULT_PERMISSION_CONFIG,
        silentLog,
      );
      const result = await handler(
        makeRequest("tool", [
          { kind: "reject_always", optionId: "always-r" },
          { kind: "reject_once", optionId: "once-r" },
        ]),
      );
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "once-r",
      });
    });

    it("cancels when no allow or reject option exists", async () => {
      const handler = createPermissionHandler(
        DEFAULT_PERMISSION_CONFIG,
        silentLog,
      );
      const result = await handler(makeRequest("tool", []));
      expect(result.outcome).toEqual({ outcome: "cancelled" });
    });
  });

  describe("edge cases", () => {
    it("handles empty allow patterns like no patterns", async () => {
      const config: PermissionConfig = {
        autoApprove: false,
        allowPatterns: [],
      };
      const handler = createPermissionHandler(config, silentLog);
      const result = await handler(makeRequest("any_tool"));
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "reject-1",
      });
    });

    it("handles missing toolCall name gracefully", async () => {
      const handler = createPermissionHandler(
        { autoApprove: true, allowPatterns: [] },
        silentLog,
      );
      const result = await handler({
        toolCall: {},
        options: [{ kind: "allow_once", optionId: "a1" }],
      } as RequestPermissionRequest);
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "a1",
      });
    });

    it("cancels when autoApprove is true but no allow option exists", async () => {
      const handler = createPermissionHandler(
        { autoApprove: true, allowPatterns: [] },
        silentLog,
      );
      const result = await handler(
        makeRequest("tool", [
          { kind: "reject_once", optionId: "r1" },
        ]),
      );
      // autoApprove can't approve without an allow option, falls to reject
      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "r1",
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../../src/github/issues.js", () => ({
  createIssue: vi.fn().mockResolvedValue({ number: 1 }),
}));

import { sanitizeForHttp, escalateToStakeholder } from "../../src/enforcement/escalation.js";
import type { EscalationEvent } from "../../src/types.js";

describe("sanitizeForHttp", () => {
  it("removes newlines", () => {
    expect(sanitizeForHttp("hello\nworld\r\nfoo")).toBe("hello world foo");
  });

  it("removes control characters", () => {
    expect(sanitizeForHttp("ab\x00c\x1fd\x7fe")).toBe("abcde");
  });

  it("truncates long strings to 500 chars", () => {
    const long = "a".repeat(600);
    const result = sanitizeForHttp(long);
    expect(result.length).toBe(500);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeForHttp("")).toBe("");
  });
});

const { execFileSpy } = vi.hoisted(() => {
  const execFileSpy = vi.fn(
    (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) =>
      cb(null, "", ""),
  );
  return { execFileSpy };
});

vi.mock("node:child_process", () => ({
  execFile: execFileSpy,
}));

describe("escalateToStakeholder with special characters", () => {
  beforeEach(() => {
    execFileSpy.mockClear();
  });

  it("does not break curl args when event contains special characters", async () => {
    const event: EscalationEvent = {
      level: "must",
      reason: "line1\nline2\rline3",
      detail: "detail\x00with\x1fcontrol\x7fchars\nand newlines",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    const config = { ntfyEnabled: true, ntfyTopic: "test-topic" };

    await escalateToStakeholder(event, config);

    expect(execFileSpy).toHaveBeenCalled();
    const args = execFileSpy.mock.calls[0][1] as string[];
    for (const arg of args) {
      expect(arg).not.toMatch(/[\r\n]/);
      // eslint-disable-next-line no-control-regex
      expect(arg).not.toMatch(/[\x00-\x1f\x7f]/);
    }
  });
});

describe("ntfy topic validation", () => {
  beforeEach(() => {
    execFileSpy.mockClear();
  });

  const baseEvent: EscalationEvent = {
    level: "should",
    reason: "test",
    detail: "detail",
    context: {},
    timestamp: new Date("2025-01-01T00:00:00Z"),
  };

  it("sends notification for valid topic names", async () => {
    for (const topic of ["my-topic", "sprint_123", "ABC"]) {
      execFileSpy.mockClear();
      await escalateToStakeholder(baseEvent, { ntfyEnabled: true, ntfyTopic: topic });
      expect(execFileSpy).toHaveBeenCalled();
    }
  });

  it("rejects invalid topic names and skips notification", async () => {
    for (const topic of ["bad topic", "topic/path", "topic@name", "has spaces"]) {
      execFileSpy.mockClear();
      await escalateToStakeholder(baseEvent, { ntfyEnabled: true, ntfyTopic: topic });
      expect(execFileSpy).not.toHaveBeenCalled();
    }
  });
});

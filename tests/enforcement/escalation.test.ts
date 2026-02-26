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

import { sanitizeForHttp, escalateToStakeholder, isValidNtfyTopic } from "../../src/enforcement/escalation.js";
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

describe("isValidNtfyTopic", () => {
  it("accepts valid topics with alphanumeric characters", () => {
    expect(isValidNtfyTopic("my-topic")).toBe(true);
    expect(isValidNtfyTopic("sprint_2")).toBe(true);
    expect(isValidNtfyTopic("ABC123")).toBe(true);
  });

  it("accepts single character topics", () => {
    expect(isValidNtfyTopic("a")).toBe(true);
    expect(isValidNtfyTopic("1")).toBe(true);
    expect(isValidNtfyTopic("-")).toBe(true);
    expect(isValidNtfyTopic("_")).toBe(true);
  });

  it("rejects topics with spaces", () => {
    expect(isValidNtfyTopic("has space")).toBe(false);
  });

  it("rejects topics with slashes", () => {
    expect(isValidNtfyTopic("has/slash")).toBe(false);
  });

  it("rejects topics with dots", () => {
    expect(isValidNtfyTopic("has.dot")).toBe(false);
  });

  it("rejects topics with special characters", () => {
    expect(isValidNtfyTopic("topic;inject")).toBe(false);
    expect(isValidNtfyTopic("topic@test")).toBe(false);
    expect(isValidNtfyTopic("topic!")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidNtfyTopic("")).toBe(false);
  });
});

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

  it("skips notification and logs error when topic is invalid", async () => {
    const event: EscalationEvent = {
      level: "must",
      reason: "test escalation",
      detail: "test detail",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    const config = { ntfyEnabled: true, ntfyTopic: "bad/topic" };

    await escalateToStakeholder(event, config);

    expect(execFileSpy).not.toHaveBeenCalled();
  });
});

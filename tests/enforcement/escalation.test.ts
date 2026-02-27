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

vi.mock("../../src/github/labels.js", () => ({
  ensureLabelExists: vi.fn().mockResolvedValue(undefined),
}));

import { sanitizeForHttp, escalateToStakeholder } from "../../src/enforcement/escalation.js";
import type { EscalationEvent } from "../../src/types.js";
import { createIssue } from "../../src/github/issues.js";
import { ensureLabelExists } from "../../src/github/labels.js";

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

describe("escalateToStakeholder label handling", () => {
  const mockCreateIssue = vi.mocked(createIssue);
  const mockEnsureLabelExists = vi.mocked(ensureLabelExists);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateIssue.mockResolvedValue({ number: 42, title: "", body: "", labels: [], state: "open" });
    mockEnsureLabelExists.mockResolvedValue(undefined);
    execFileSpy.mockClear();
  });

  it("ensures labels exist before creating escalation issue", async () => {
    const event: EscalationEvent = {
      level: "must",
      reason: "Test escalation",
      detail: "Test detail",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    await escalateToStakeholder(event, { ntfyEnabled: false });

    // Verify ensureLabelExists was called for both labels
    expect(mockEnsureLabelExists).toHaveBeenCalledWith("type:escalation", "D73A4A", "Escalation issue");
    expect(mockEnsureLabelExists).toHaveBeenCalledWith("priority:must", "B60205", "Must priority");
    expect(mockEnsureLabelExists).toHaveBeenCalledTimes(2);

    // Verify createIssue was called with labels
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ["type:escalation", "priority:must"],
      }),
    );
  });

  it("creates issue without labels if ensureLabelExists fails", async () => {
    mockEnsureLabelExists.mockRejectedValue(new Error("Label creation failed"));

    const event: EscalationEvent = {
      level: "should",
      reason: "Test escalation",
      detail: "Test detail",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    await escalateToStakeholder(event, { ntfyEnabled: false });

    // Should attempt label creation
    expect(mockEnsureLabelExists).toHaveBeenCalled();

    // Should still create issue (fallback without labels)
    expect(mockCreateIssue).toHaveBeenCalled();
  });

  it("handles different priority levels with correct colors", async () => {
    const shouldEvent: EscalationEvent = {
      level: "should",
      reason: "Test",
      detail: "Detail",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    await escalateToStakeholder(shouldEvent, { ntfyEnabled: false });

    expect(mockEnsureLabelExists).toHaveBeenCalledWith("priority:should", "FBCA04", "Should priority");

    vi.clearAllMocks();

    const couldEvent: EscalationEvent = {
      level: "could",
      reason: "Test",
      detail: "Detail",
      context: {},
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };

    await escalateToStakeholder(couldEvent, { ntfyEnabled: false });

    expect(mockEnsureLabelExists).toHaveBeenCalledWith("priority:could", "0E8A16", "Could priority");
  });
});

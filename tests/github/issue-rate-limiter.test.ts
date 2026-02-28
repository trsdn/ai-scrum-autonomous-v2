import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssueRateLimited } from "../../src/github/issue-rate-limiter.js";
import * as issues from "../../src/github/issues.js";

vi.mock("../../src/github/issues.js", () => ({
  createIssue: vi.fn(),
}));

const mockCreateIssue = vi.mocked(issues.createIssue);
const mockIssue = { number: 1, title: "Test", body: "Body", labels: [] as string[], state: "OPEN" };

beforeEach(() => { vi.restoreAllMocks(); });

describe("createIssueRateLimited", () => {
  it("allows creation when under limit and increments counter", async () => {
    const state = { issuesCreatedCount: 5 };
    mockCreateIssue.mockResolvedValue(mockIssue);

    const result = await createIssueRateLimited({ title: "Test", body: "Body" }, state, 10);

    expect(result).toEqual(mockIssue);
    expect(state.issuesCreatedCount).toBe(6);
    expect(mockCreateIssue).toHaveBeenCalledWith({ title: "Test", body: "Body" });
  });

  it("blocks creation at or over limit and returns null", async () => {
    for (const count of [10, 15]) {
      const state = { issuesCreatedCount: count };
      const result = await createIssueRateLimited({ title: "Test", body: "Body" }, state, 10);
      expect(result).toBeNull();
      expect(state.issuesCreatedCount).toBe(count);
      expect(mockCreateIssue).not.toHaveBeenCalled();
    }
  });

  it("does not increment counter when creation fails", async () => {
    const state = { issuesCreatedCount: 3 };
    mockCreateIssue.mockRejectedValue(new Error("GitHub API error"));

    await expect(
      createIssueRateLimited({ title: "Test", body: "Body" }, state, 10),
    ).rejects.toThrow("GitHub API error");

    expect(state.issuesCreatedCount).toBe(3);
  });

  it("allows creation at exactly limit-1 (boundary)", async () => {
    const state = { issuesCreatedCount: 9 };
    mockCreateIssue.mockResolvedValue({ ...mockIssue, number: 10 });

    const result = await createIssueRateLimited({ title: "Last", body: "Body" }, state, 10);

    expect(result).toBeTruthy();
    expect(state.issuesCreatedCount).toBe(10);
  });

  it("passes labels through to createIssue", async () => {
    const state = { issuesCreatedCount: 0 };
    mockCreateIssue.mockResolvedValue({ ...mockIssue, labels: ["bug", "high"] });

    await createIssueRateLimited({ title: "Test", body: "Body", labels: ["bug", "high"] }, state, 10);

    expect(mockCreateIssue).toHaveBeenCalledWith({ title: "Test", body: "Body", labels: ["bug", "high"] });
  });
});

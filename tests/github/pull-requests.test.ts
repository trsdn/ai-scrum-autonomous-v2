import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPullRequests } from "../../src/github/pull-requests.js";

const mockExecGh = vi.fn();

vi.mock("../../src/github/issues.js", () => ({
  execGh: (...args: unknown[]) => mockExecGh(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPullRequests", () => {
  it("returns parsed PR list when gh CLI succeeds", async () => {
    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        {
          number: 42,
          headRefName: "feat/test-branch",
          state: "OPEN",
          mergeStateStatus: "CLEAN",
          url: "https://github.com/owner/repo/pull/42",
        },
        {
          number: 43,
          headRefName: "fix/another-branch",
          state: "OPEN",
          mergeStateStatus: "UNSTABLE",
          url: "https://github.com/owner/repo/pull/43",
        },
      ]),
    );

    const result = await listPullRequests();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      number: 42,
      headRefName: "feat/test-branch",
      state: "OPEN",
      mergeStateStatus: "CLEAN",
      url: "https://github.com/owner/repo/pull/42",
    });
    expect(mockExecGh).toHaveBeenCalledWith([
      "pr",
      "list",
      "--json",
      "number,headRefName,state,mergeStateStatus,url",
    ]);
  });

  it("filters by state parameter", async () => {
    mockExecGh.mockResolvedValueOnce(JSON.stringify([]));

    await listPullRequests({ state: "open" });

    expect(mockExecGh).toHaveBeenCalledWith([
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "number,headRefName,state,mergeStateStatus,url",
    ]);
  });

  it("handles empty PR list", async () => {
    mockExecGh.mockResolvedValueOnce("[]");

    const result = await listPullRequests();

    expect(result).toEqual([]);
  });

  it("includes base branch filter when provided", async () => {
    mockExecGh.mockResolvedValueOnce(JSON.stringify([]));

    await listPullRequests({ base: "main" });

    expect(mockExecGh).toHaveBeenCalledWith([
      "pr",
      "list",
      "--base",
      "main",
      "--json",
      "number,headRefName,state,mergeStateStatus,url",
    ]);
  });

  it("includes head branch filter when provided", async () => {
    mockExecGh.mockResolvedValueOnce(JSON.stringify([]));

    await listPullRequests({ head: "feat/test" });

    expect(mockExecGh).toHaveBeenCalledWith([
      "pr",
      "list",
      "--head",
      "feat/test",
      "--json",
      "number,headRefName,state,mergeStateStatus,url",
    ]);
  });
});

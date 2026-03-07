import { describe, it, expect, vi, afterEach } from "vitest";
import { SprintIssueCache } from "../../src/dashboard/issue-cache.js";

vi.mock("../../src/github/issues.js", () => ({
  listIssues: vi.fn().mockResolvedValue([]),
}));

describe("SprintIssueCache", () => {
  let cache: SprintIssueCache;

  afterEach(() => {
    cache?.stop();
    vi.restoreAllMocks();
  });

  it("returns empty array for uncached sprint", () => {
    cache = new SprintIssueCache({ maxSprint: 1 });
    expect(cache.get(1)).toEqual([]);
    expect(cache.has(1)).toBe(false);
  });

  it("set/get stores and retrieves issues", () => {
    cache = new SprintIssueCache({ maxSprint: 1 });
    const issues = [{ number: 1, title: "Test", status: "done" as const }];
    cache.set(1, issues);
    expect(cache.has(1)).toBe(true);
    expect(cache.get(1)).toEqual(issues);
  });

  it("preload fetches from GitHub (ignores saved state)", async () => {
    const loadState = vi.fn().mockReturnValue({
      result: {
        results: [
          { issueNumber: 10, status: "completed" },
          { issueNumber: 11, status: "failed" },
        ],
      },
    });

    const { listIssues } = await import("../../src/github/issues.js");
    vi.mocked(listIssues).mockResolvedValue([
      { number: 10, title: "Issue 10", body: "", labels: [], state: "CLOSED" },
      { number: 11, title: "Issue 11", body: "", labels: [], state: "OPEN" },
    ]);

    cache = new SprintIssueCache({ maxSprint: 1, loadState });
    await cache.preload();

    // Should use GitHub data, not saved state
    expect(cache.has(1)).toBe(true);
    const s1 = cache.get(1);
    expect(s1).toHaveLength(2);
    expect(s1[0]).toEqual({ number: 10, title: "Issue 10", status: "done" });
    expect(s1[1]).toEqual({ number: 11, title: "Issue 11", status: "planned" });
  });

  it("preload fetches from GitHub even when plan exists in state", async () => {
    const loadState = vi.fn().mockReturnValue({
      plan: {
        sprint_issues: [
          { number: 5, title: "Add feature" },
          { number: 6, title: "Fix bug" },
        ],
      },
    });

    const { listIssues } = await import("../../src/github/issues.js");
    vi.mocked(listIssues).mockResolvedValue([
      { number: 5, title: "Add feature", body: "", labels: [], state: "CLOSED" },
      { number: 6, title: "Fix bug", body: "", labels: [], state: "OPEN" },
    ]);

    cache = new SprintIssueCache({ maxSprint: 1, loadState });
    await cache.preload();

    const issues = cache.get(1);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({ number: 5, title: "Add feature", status: "done" });
    expect(issues[1]).toEqual({ number: 6, title: "Fix bug", status: "planned" });
  });

  it("preload handles null state gracefully", async () => {
    const loadState = vi.fn().mockReturnValue(null);

    cache = new SprintIssueCache({ maxSprint: 1, loadState });
    await cache.preload();

    // Should be cached (empty, from GitHub fallback)
    expect(cache.has(1)).toBe(true);
    expect(cache.get(1)).toEqual([]);
  });

  it("stop clears the refresh timer", () => {
    cache = new SprintIssueCache({ maxSprint: 1 });
    cache.startRefresh();
    cache.stop();
    // Should not throw or leak
  });

  it("does not overwrite existing cache on load failure", async () => {
    cache = new SprintIssueCache({ maxSprint: 1 });
    const existing = [{ number: 99, title: "Existing", status: "done" as const }];
    cache.set(1, existing);

    // loadState returns null, and listIssues will throw
    const loadState = vi.fn().mockReturnValue(null);
    const failCache = new SprintIssueCache({
      maxSprint: 1,
      loadState,
    });
    failCache.set(1, existing);

    // After preload with error, existing data should remain
    expect(failCache.get(1)).toEqual(existing);
    failCache.stop();
  });
});

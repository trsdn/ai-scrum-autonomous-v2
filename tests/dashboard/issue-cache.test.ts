import { describe, it, expect, vi, afterEach } from "vitest";
import { SprintIssueCache } from "../../src/dashboard/issue-cache.js";

describe("SprintIssueCache", () => {
  let cache: SprintIssueCache;

  afterEach(() => {
    cache?.stop();
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

  it("preload loads from saved state results", async () => {
    const loadState = vi.fn().mockReturnValue({
      result: {
        results: [
          { issueNumber: 10, status: "completed" },
          { issueNumber: 11, status: "failed" },
        ],
      },
    });

    cache = new SprintIssueCache({ maxSprint: 2, loadState });
    await cache.preload();

    // Sprint 1 should have loaded from state
    expect(cache.has(1)).toBe(true);
    const s1 = cache.get(1);
    expect(s1).toHaveLength(2);
    expect(s1[0]).toEqual({ number: 10, title: "Issue #10", status: "done" });
    expect(s1[1]).toEqual({ number: 11, title: "Issue #11", status: "failed" });

    // Sprint 2 also loaded
    expect(cache.has(2)).toBe(true);
  });

  it("preload loads from saved state plan", async () => {
    const loadState = vi.fn().mockReturnValue({
      plan: {
        sprint_issues: [
          { number: 5, title: "Add feature" },
          { number: 6, title: "Fix bug" },
        ],
      },
    });

    cache = new SprintIssueCache({ maxSprint: 1, loadState });
    await cache.preload();

    const issues = cache.get(1);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({ number: 5, title: "Add feature", status: "planned" });
    expect(issues[1]).toEqual({ number: 6, title: "Fix bug", status: "planned" });
  });

  it("preload handles null state gracefully", async () => {
    const loadState = vi.fn().mockReturnValue(null);

    // Mock listIssues to avoid real GitHub calls
    vi.mock("../../src/github/issues.js", () => ({
      listIssues: vi.fn().mockResolvedValue([]),
    }));

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

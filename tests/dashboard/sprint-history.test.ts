import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VelocityEntry } from "../../src/documentation/velocity.js";

vi.mock("../../src/documentation/velocity.js", () => ({
  readVelocity: vi.fn(),
}));

import { loadSprintHistory } from "../../src/dashboard/sprint-history.js";
import { readVelocity } from "../../src/documentation/velocity.js";

const mockedReadVelocity = vi.mocked(readVelocity);

function makeEntry(overrides: Partial<VelocityEntry> = {}): VelocityEntry {
  return {
    sprint: 1,
    date: "2025-01-01",
    goal: "Test goal",
    planned: 5,
    done: 4,
    carry: 1,
    hours: 2,
    issuesPerHr: 2.0,
    notes: "",
    ...overrides,
  };
}

describe("loadSprintHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when velocity has no entries", () => {
    mockedReadVelocity.mockReturnValue([]);
    const result = loadSprintHistory();
    expect(result).toEqual([]);
    expect(mockedReadVelocity).toHaveBeenCalledOnce();
  });

  it("passes custom path to readVelocity", () => {
    mockedReadVelocity.mockReturnValue([]);
    loadSprintHistory("/custom/path.md");
    expect(mockedReadVelocity).toHaveBeenCalledWith("/custom/path.md");
  });

  it("maps velocity entries to SprintHistoryEntry objects", () => {
    mockedReadVelocity.mockReturnValue([makeEntry()]);
    const [entry] = loadSprintHistory();

    expect(entry).toBeDefined();
    expect(entry!.sprintNumber).toBe(1);
    expect(entry!.date).toBe("2025-01-01");
    expect(entry!.improvements).toEqual([]);
  });

  it("computes metrics correctly from velocity data", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ planned: 10, done: 8, carry: 2, hours: 4, issuesPerHr: 2.0 }),
    ]);
    const [entry] = loadSprintHistory();
    const m = entry!.metrics;

    expect(m.planned).toBe(10);
    expect(m.completed).toBe(8);
    expect(m.failed).toBe(2);
    expect(m.pointsPlanned).toBe(10);
    expect(m.pointsCompleted).toBe(8);
    expect(m.velocity).toBe(2.0);
    expect(m.firstPassRate).toBe(0.8);
    expect(m.driftIncidents).toBe(0);
  });

  it("computes avgDuration as (hours / done) * 60", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ hours: 6, done: 3 }),
    ]);
    const [entry] = loadSprintHistory();
    expect(entry!.metrics.avgDuration).toBe(120); // (6/3)*60
  });

  it("sets avgDuration to 0 when hours is 0", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ hours: 0, done: 5 }),
    ]);
    const [entry] = loadSprintHistory();
    expect(entry!.metrics.avgDuration).toBe(0);
  });

  it("sets avgDuration to 0 when done is 0", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ hours: 4, done: 0 }),
    ]);
    const [entry] = loadSprintHistory();
    expect(entry!.metrics.avgDuration).toBe(0);
  });

  it("sets firstPassRate to 0 when planned is 0", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ planned: 0, done: 0 }),
    ]);
    const [entry] = loadSprintHistory();
    expect(entry!.metrics.firstPassRate).toBe(0);
  });

  it("maps multiple entries preserving order", () => {
    mockedReadVelocity.mockReturnValue([
      makeEntry({ sprint: 1 }),
      makeEntry({ sprint: 2, date: "2025-02-01" }),
      makeEntry({ sprint: 3, date: "2025-03-01" }),
    ]);
    const result = loadSprintHistory();
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.sprintNumber)).toEqual([1, 2, 3]);
  });
});

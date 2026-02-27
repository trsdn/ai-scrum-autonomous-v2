import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";
import { getMilestone, getNextOpenMilestone, parseSprintFromTitle } from "../../src/github/milestones.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(cp.execFile);

function mockExecFileSuccess(stdout: string): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, callback: unknown) => {
      (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
        null,
        { stdout, stderr: "" },
      );
    }) as typeof cp.execFile,
  );
}

function mockExecFileError(err: Error): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, callback: unknown) => {
      (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
        err,
        { stdout: "", stderr: err.message },
      );
    }) as typeof cp.execFile,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getMilestone", () => {
  it("returns matching milestone by title", async () => {
    const milestones = [
      { title: "Sprint 1", number: 1, description: "First", state: "open" },
      { title: "Sprint 2", number: 2, description: "Second", state: "open" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getMilestone("Sprint 2");
    expect(result).toEqual(milestones[1]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["api", "repos/{owner}/{repo}/milestones", "--paginate"],
      expect.any(Function),
    );
  });

  it("handles titles with quotes and special characters safely", async () => {
    const milestones = [
      { title: 'Sprint "alpha" & <beta>', number: 3, description: "", state: "open" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getMilestone('Sprint "alpha" & <beta>');
    expect(result).toEqual(milestones[0]);
  });

  it("returns undefined when milestone not found", async () => {
    const milestones = [
      { title: "Sprint 1", number: 1, description: "", state: "open" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getMilestone("Nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns undefined when API returns empty string", async () => {
    mockExecFileSuccess("");

    const result = await getMilestone("Sprint 1");
    expect(result).toBeUndefined();
  });
});

describe("parseSprintFromTitle", () => {
  it("parses 'Sprint 3' to 3", () => {
    expect(parseSprintFromTitle("Sprint 3")).toBe(3);
  });

  it("parses 'sprint 12' case-insensitively", () => {
    expect(parseSprintFromTitle("sprint 12")).toBe(12);
  });

  it("returns undefined for non-sprint titles", () => {
    expect(parseSprintFromTitle("Release 1.0")).toBeUndefined();
    expect(parseSprintFromTitle("Sprint")).toBeUndefined();
    expect(parseSprintFromTitle("My Sprint 3")).toBeUndefined();
  });

  it("parses custom prefix 'Test Sprint 1'", () => {
    expect(parseSprintFromTitle("Test Sprint 1", "Test Sprint")).toBe(1);
  });

  it("returns undefined when title doesn't match custom prefix", () => {
    expect(parseSprintFromTitle("Sprint 1", "Test Sprint")).toBeUndefined();
  });
});

describe("getNextOpenMilestone", () => {
  it("returns the lowest-numbered open sprint milestone", async () => {
    const milestones = [
      { title: "Sprint 5", number: 5, description: "", state: "open" },
      { title: "Sprint 3", number: 3, description: "", state: "open" },
      { title: "Sprint 2", number: 2, description: "", state: "closed" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getNextOpenMilestone();
    expect(result).toBeDefined();
    expect(result!.sprintNumber).toBe(3);
    expect(result!.milestone.title).toBe("Sprint 3");
  });

  it("skips closed milestones", async () => {
    const milestones = [
      { title: "Sprint 1", number: 1, description: "", state: "closed" },
      { title: "Sprint 2", number: 2, description: "", state: "closed" },
      { title: "Sprint 3", number: 3, description: "", state: "open" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getNextOpenMilestone();
    expect(result!.sprintNumber).toBe(3);
  });

  it("returns undefined when no milestones exist", async () => {
    mockExecFileSuccess("");

    const result = await getNextOpenMilestone();
    expect(result).toBeUndefined();
  });

  it("returns undefined when API fails", async () => {
    mockExecFileError(new Error("gh: not authenticated"));

    const result = await getNextOpenMilestone();
    expect(result).toBeUndefined();
  });

  it("skips non-sprint milestones", async () => {
    const milestones = [
      { title: "Release 1.0", number: 1, description: "", state: "open" },
      { title: "Backlog", number: 2, description: "", state: "open" },
      { title: "Sprint 7", number: 3, description: "", state: "open" },
    ];
    mockExecFileSuccess(JSON.stringify(milestones));

    const result = await getNextOpenMilestone();
    expect(result!.sprintNumber).toBe(7);
  });
});

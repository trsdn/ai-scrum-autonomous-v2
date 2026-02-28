import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";
import { getMilestone, getNextOpenMilestone, parseSprintFromTitle, createMilestone, setMilestone, closeMilestone, listSprintMilestones } from "../../src/github/milestones.js";

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

describe("createMilestone", () => {
  it("creates a milestone and returns the parsed result", async () => {
    const created = { title: "Sprint 5", number: 5, description: "Test", state: "open" };
    mockExecFileSuccess(JSON.stringify(created));

    const result = await createMilestone("Sprint 5", "Test");
    expect(result.title).toBe("Sprint 5");
    expect(result.number).toBe(5);
  });

  it("creates a milestone without description", async () => {
    const created = { title: "Sprint 6", number: 6, description: "", state: "open" };
    mockExecFileSuccess(JSON.stringify(created));

    const result = await createMilestone("Sprint 6");
    expect(result.title).toBe("Sprint 6");
  });
});

describe("setMilestone", () => {
  it("calls gh issue edit with milestone title", async () => {
    mockExecFileSuccess("");

    await setMilestone(42, "Sprint 3");

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("gh");
    expect(callArgs[1]).toContain("--milestone");
    expect(callArgs[1]).toContain("Sprint 3");
  });
});

describe("closeMilestone", () => {
  it("closes a milestone by title", async () => {
    // First call: getMilestone lookup, second call: PATCH
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        const data = callCount === 1
          ? JSON.stringify([{ title: "Sprint 2", number: 2, description: "", state: "open" }])
          : "";
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    await closeMilestone("Sprint 2");
    expect(callCount).toBe(2);
  });

  it("throws when milestone not found", async () => {
    mockExecFileSuccess(JSON.stringify([]));

    await expect(closeMilestone("Sprint 99")).rejects.toThrow("Milestone not found");
  });
});

describe("listSprintMilestones", () => {
  it("returns sorted sprint milestones from both open and closed states", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        const data = callCount === 1
          ? JSON.stringify([{ title: "Sprint 3", number: 3, description: "", state: "open" }])
          : JSON.stringify([{ title: "Sprint 1", number: 1, description: "", state: "closed" }]);
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    const result = await listSprintMilestones();
    expect(result).toHaveLength(2);
    expect(result[0].sprintNumber).toBe(1);
    expect(result[1].sprintNumber).toBe(3);
  });

  it("handles API failure for one state gracefully", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        if (callCount === 1) {
          (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: JSON.stringify([{ title: "Sprint 2", number: 2, description: "", state: "open" }]), stderr: "" },
          );
        } else {
          (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
            new Error("API error"),
            { stdout: "", stderr: "API error" },
          );
        }
      }) as typeof cp.execFile,
    );

    const result = await listSprintMilestones();
    expect(result).toHaveLength(1);
    expect(result[0].sprintNumber).toBe(2);
  });

  it("filters non-sprint milestones", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        const data = callCount === 1
          ? JSON.stringify([
              { title: "Sprint 1", number: 1, description: "", state: "open" },
              { title: "Backlog", number: 2, description: "", state: "open" },
            ])
          : JSON.stringify([]);
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    const result = await listSprintMilestones();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Sprint 1");
  });

  it("uses custom prefix", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        const data = callCount === 1
          ? JSON.stringify([{ title: "Iteration 5", number: 5, description: "", state: "open" }])
          : JSON.stringify([]);
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    const result = await listSprintMilestones("Iteration");
    expect(result).toHaveLength(1);
    expect(result[0].sprintNumber).toBe(5);
  });
});

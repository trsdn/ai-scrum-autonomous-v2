import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";
import { getMilestone } from "../../src/github/milestones.js";

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

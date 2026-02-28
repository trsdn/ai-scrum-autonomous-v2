import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";

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

describe("getPRStats", () => {
  it("returns stats for a branch with an open PR", async () => {
    const { getPRStats } = await import("../../src/git/merge.js");
    const stats = [{ number: 42, additions: 100, deletions: 20, changedFiles: 5 }];
    mockExecFileSuccess(JSON.stringify(stats));

    const result = await getPRStats("feature/test");
    expect(result).toEqual({ number: 42, additions: 100, deletions: 20, changedFiles: 5 });
  });

  it("returns undefined when no PR exists", async () => {
    const { getPRStats } = await import("../../src/git/merge.js");
    mockExecFileSuccess(JSON.stringify([]));

    const result = await getPRStats("no-pr-branch");
    expect(result).toBeUndefined();
  });

  it("returns undefined on API error", async () => {
    const { getPRStats } = await import("../../src/git/merge.js");
    mockExecFileError(new Error("API failure"));

    const result = await getPRStats("broken");
    expect(result).toBeUndefined();
  });
});

describe("mergeIssuePR", () => {
  it("finds and merges a PR by branch name", async () => {
    const { mergeIssuePR } = await import("../../src/git/merge.js");
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        const data = callCount === 1
          ? JSON.stringify([{ number: 10 }])
          : "";
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    const result = await mergeIssuePR("sprint/1/issue-5");
    expect(result.success).toBe(true);
    expect(result.prNumber).toBe(10);
  });

  it("returns failure when no open PR found", async () => {
    const { mergeIssuePR } = await import("../../src/git/merge.js");
    mockExecFileSuccess(JSON.stringify([]));

    const result = await mergeIssuePR("orphan-branch");
    expect(result.success).toBe(false);
    expect(result.reason).toContain("No open PR");
  });

  it("returns failure when PR lookup fails", async () => {
    const { mergeIssuePR } = await import("../../src/git/merge.js");
    mockExecFileError(new Error("network error"));

    const result = await mergeIssuePR("broken-branch");
    expect(result.success).toBe(false);
    expect(result.reason).toContain("Could not find PR");
  });

  it("passes squash and delete-branch flags", async () => {
    const { mergeIssuePR } = await import("../../src/git/merge.js");
    let mergeArgs: unknown[] = [];
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, args: unknown, callback: unknown) => {
        callCount++;
        if (callCount === 2) mergeArgs = args as unknown[];
        const data = callCount === 1 ? JSON.stringify([{ number: 7 }]) : "";
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: data, stderr: "" },
        );
      }) as typeof cp.execFile,
    );

    await mergeIssuePR("feat-branch", { squash: true, deleteBranch: true });
    expect(mergeArgs).toContain("--squash");
    expect(mergeArgs).toContain("--delete-branch");
  });

  it("returns failure with reason when merge command fails", async () => {
    const { mergeIssuePR } = await import("../../src/git/merge.js");
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        callCount++;
        if (callCount === 1) {
          (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: JSON.stringify([{ number: 15 }]), stderr: "" },
          );
        } else {
          (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
            new Error("merge conflict"),
            { stdout: "", stderr: "merge conflict" },
          );
        }
      }) as typeof cp.execFile,
    );

    const result = await mergeIssuePR("conflict-branch");
    expect(result.success).toBe(false);
    expect(result.prNumber).toBe(15);
    expect(result.reason).toContain("merge conflict");
  });
});

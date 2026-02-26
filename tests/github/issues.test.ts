import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";
import { getIssue, addComment, listIssues, execGh } from "../../src/github/issues.js";

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

function mockExecFileError(message: string): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, callback: unknown) => {
      (callback as (err: Error | null) => void)(new Error(message));
    }) as typeof cp.execFile,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("execGh", () => {
  it("calls gh with provided args", async () => {
    mockExecFileSuccess('{"ok": true}');
    const result = await execGh(["issue", "list"]);
    expect(result).toBe('{"ok": true}');
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "list"],
      expect.any(Function),
    );
  });

  it("throws on failure with descriptive message", async () => {
    mockExecFileError("not authenticated");
    await expect(execGh(["issue", "list"])).rejects.toThrow(
      "gh issue list failed: not authenticated",
    );
  });
});

describe("getIssue", () => {
  it("returns parsed issue data", async () => {
    const issue = {
      number: 42,
      title: "Fix bug",
      body: "Some body",
      labels: [{ name: "bug" }],
      state: "OPEN",
    };
    mockExecFileSuccess(JSON.stringify(issue));

    const result = await getIssue(42);
    expect(result).toEqual(issue);
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "view", "42", "--json", "number,title,body,labels,state"],
      expect.any(Function),
    );
  });

  it("throws when issue not found", async () => {
    mockExecFileError("Could not resolve to an issue");
    await expect(getIssue(9999)).rejects.toThrow("gh issue view 9999");
  });
});

describe("addComment", () => {
  it("calls gh issue comment with body", async () => {
    mockExecFileSuccess("");
    await addComment(10, "Hello world");
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "10", "--body", "Hello world"],
      expect.any(Function),
    );
  });

  it("throws on error", async () => {
    mockExecFileError("permission denied");
    await expect(addComment(10, "test")).rejects.toThrow("permission denied");
  });
});

describe("listIssues", () => {
  it("lists issues without filters", async () => {
    const issues = [
      { number: 1, title: "A", body: "", labels: [], state: "OPEN" },
    ];
    mockExecFileSuccess(JSON.stringify(issues));

    const result = await listIssues();
    expect(result).toEqual(issues);
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      ["issue", "list", "--json", "number,title,body,labels,state"],
      expect.any(Function),
    );
  });

  it("passes label and state filters", async () => {
    mockExecFileSuccess("[]");

    await listIssues({ labels: ["bug", "urgent"], state: "open" });
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      [
        "issue", "list",
        "--json", "number,title,body,labels,state",
        "--label", "bug,urgent",
        "--state", "open",
      ],
      expect.any(Function),
    );
  });

  it("passes milestone filter", async () => {
    mockExecFileSuccess("[]");

    await listIssues({ milestone: "Sprint 1" });
    expect(mockExecFile).toHaveBeenCalledWith(
      "gh",
      [
        "issue", "list",
        "--json", "number,title,body,labels,state",
        "--milestone", "Sprint 1",
      ],
      expect.any(Function),
    );
  });
});

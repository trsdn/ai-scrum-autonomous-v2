import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cp from "node:child_process";
import { getIssue, addComment, listIssues, execGh, createIssue } from "../../src/github/issues.js";

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

function mockExecFileErrorWithCode(message: string, code: string | number): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, callback: unknown) => {
      const err = new Error(message) as NodeJS.ErrnoException;
      err.code = String(code);
      // For numeric exit codes, set as number to match child_process behavior
      if (typeof code === "number") {
        (err as unknown as Record<string, unknown>).code = code;
      }
      (callback as (err: Error | null) => void)(err);
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

  it("throws helpful message when gh CLI is not installed (ENOENT)", async () => {
    mockExecFileErrorWithCode("spawn gh ENOENT", "ENOENT");
    await expect(execGh(["issue", "list"])).rejects.toThrow(
      "gh CLI not found. Install it: https://cli.github.com/",
    );
  });

  it("throws helpful message when gh CLI is not authenticated (exit code 4)", async () => {
    mockExecFileErrorWithCode("gh auth required", 4);
    await expect(execGh(["issue", "list"])).rejects.toThrow(
      "gh CLI not authenticated. Run: gh auth login",
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

describe("createIssue validation", () => {
  it("throws when title is empty string", async () => {
    await expect(
      createIssue({ title: "", body: "test" }),
    ).rejects.toThrow("cannot be empty");
  });

  it("throws when title is only whitespace", async () => {
    await expect(
      createIssue({ title: "   ", body: "test" }),
    ).rejects.toThrow("cannot be empty");
  });

  it("throws when title is exactly 'undefined'", async () => {
    await expect(
      createIssue({ title: "undefined", body: "test" }),
    ).rejects.toThrow('cannot be "undefined"');
  });

  it("throws when title is exactly 'Undefined' (case insensitive)", async () => {
    await expect(
      createIssue({ title: "Undefined", body: "test" }),
    ).rejects.toThrow('cannot be "undefined"');
  });

  it("allows titles containing the word 'undefined' in context", async () => {
    mockExecFileSuccess("https://github.com/owner/repo/issues/1");
    mockExecFile.mockImplementationOnce(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "https://github.com/owner/repo/issues/1", stderr: "" },
        );
      }) as typeof cp.execFile,
    ).mockImplementationOnce(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { 
            stdout: JSON.stringify({
              number: 1,
              title: "Fix undefined behavior in parser",
              body: "Body",
              labels: [],
              state: "open",
            }), 
            stderr: "" 
          },
        );
      }) as typeof cp.execFile,
    );

    const result = await createIssue({ title: "Fix undefined behavior in parser", body: "Body" });
    expect(result.number).toBe(1);
  });

  it("succeeds with valid title", async () => {
    mockExecFileSuccess("https://github.com/owner/repo/issues/1");
    // Mock the getIssue call that follows createIssue
    mockExecFile.mockImplementationOnce(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: "https://github.com/owner/repo/issues/1", stderr: "" },
        );
      }) as typeof cp.execFile,
    ).mockImplementationOnce(
      ((_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { 
            stdout: JSON.stringify({
              number: 1,
              title: "Valid title",
              body: "Body",
              labels: [],
              state: "open",
            }), 
            stderr: "" 
          },
        );
      }) as typeof cp.execFile,
    );

    const result = await createIssue({ title: "Valid title", body: "Body" });
    expect(result.number).toBe(1);
    expect(result.title).toBe("Valid title");
  });
});

describe("updateIssue validation", () => {
  it("validates title when provided", async () => {
    await expect(
      async () => {
        const { updateIssue } = await import("../../src/github/issues.js");
        return updateIssue(1, { title: "undefined" });
      }
    ).rejects.toThrow('cannot be "undefined"');
  });

  it("allows valid title updates", async () => {
    mockExecFileSuccess("");
    const { updateIssue } = await import("../../src/github/issues.js");
    await expect(updateIssue(1, { title: "Fix undefined behavior" })).resolves.not.toThrow();
  });

  it("allows updates without title", async () => {
    mockExecFileSuccess("");
    const { updateIssue } = await import("../../src/github/issues.js");
    await expect(updateIssue(1, { body: "New body" })).resolves.not.toThrow();
  });
});

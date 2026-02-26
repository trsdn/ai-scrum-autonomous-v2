import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitForCiGreen, autoMergePr, reportDeployStatus } from "../../src/enforcement/ci-cd.js";

const mockExecGh = vi.fn();
const mockAddComment = vi.fn();

vi.mock("../../src/github/issues.js", () => ({
  execGh: (...args: unknown[]) => mockExecGh(...args),
  addComment: (...args: unknown[]) => mockAddComment(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("waitForCiGreen", () => {
  it("returns green when all checks pass", async () => {
    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "success" },
      ]),
    );

    const result = await waitForCiGreen("feat/test", 5000, 100);

    expect(result.allGreen).toBe(true);
    expect(result.checks).toHaveLength(2);
  });

  it("returns non-green when checks fail", async () => {
    mockExecGh.mockResolvedValueOnce(
      JSON.stringify([
        { name: "build", status: "completed", conclusion: "success" },
        { name: "test", status: "completed", conclusion: "failure" },
      ]),
    );

    const result = await waitForCiGreen("feat/test", 5000, 100);

    expect(result.allGreen).toBe(false);
    expect(result.checks).toHaveLength(2);
  });

  it("times out gracefully", async () => {
    // Always return in-progress checks
    mockExecGh.mockResolvedValue(
      JSON.stringify([{ name: "build", status: "in_progress", conclusion: "" }]),
    );

    const result = await waitForCiGreen("feat/test", 200, 50);

    expect(result.allGreen).toBe(false);
    expect(result.checks).toHaveLength(1);
  });
});

describe("autoMergePr", () => {
  it("returns merged:true on success", async () => {
    mockExecGh.mockResolvedValueOnce("");

    const result = await autoMergePr(42);

    expect(result.merged).toBe(true);
    expect(result.prNumber).toBe(42);
    expect(result.error).toBeUndefined();
    expect(mockExecGh).toHaveBeenCalledWith(["pr", "merge", "42", "--delete-branch", "--squash"]);
  });

  it("returns merged:false with error on failure", async () => {
    mockExecGh.mockRejectedValueOnce(new Error("merge conflict"));

    const result = await autoMergePr(99);

    expect(result.merged).toBe(false);
    expect(result.prNumber).toBe(99);
    expect(result.error).toBe("merge conflict");
  });
});

describe("reportDeployStatus", () => {
  it("posts comment with success status", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);

    await reportDeployStatus(10, "success", "Deployed v1.0");

    expect(mockAddComment).toHaveBeenCalledWith(
      10,
      "## ✅ Deployment success\n\nDeployed v1.0",
    );
  });

  it("posts comment with failure status", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);

    await reportDeployStatus(10, "failure", "Build failed");

    expect(mockAddComment).toHaveBeenCalledWith(
      10,
      "## ❌ Deployment failure\n\nBuild failed",
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/github/issues.js", () => ({
  execGh: vi.fn().mockResolvedValue(""),
  addComment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { execGh, addComment } from "../../src/github/issues.js";
import {
  setLabel,
  removeLabel,
  getLabels,
  ensureLabelExists,
  setBlockedStatus,
} from "../../src/github/labels.js";

const mockExecGh = vi.mocked(execGh);
const mockAddComment = vi.mocked(addComment);

describe("labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecGh.mockResolvedValue("");
  });

  it("setLabel calls gh issue edit with --add-label", async () => {
    await setLabel(42, "bug");
    expect(mockExecGh).toHaveBeenCalledWith([
      "issue",
      "edit",
      "42",
      "--add-label",
      "bug",
    ]);
  });

  it("removeLabel calls gh issue edit with --remove-label", async () => {
    await removeLabel(42, "bug");
    expect(mockExecGh).toHaveBeenCalledWith([
      "issue",
      "edit",
      "42",
      "--remove-label",
      "bug",
    ]);
  });

  it("getLabels returns parsed label array", async () => {
    mockExecGh.mockResolvedValueOnce('{"labels": [{"name": "bug"}]}');
    const result = await getLabels(42);
    expect(result).toEqual([{ name: "bug" }]);
  });

  it("ensureLabelExists creates label when not found", async () => {
    mockExecGh.mockResolvedValueOnce("[]"); // list call
    await ensureLabelExists("new-label");
    expect(mockExecGh).toHaveBeenCalledTimes(2);
    expect(mockExecGh).toHaveBeenNthCalledWith(2, [
      "label",
      "create",
      "new-label",
      "--force",
    ]);
  });

  it("ensureLabelExists skips creation when label exists", async () => {
    mockExecGh.mockResolvedValueOnce('[{"name": "bug"}]'); // list call
    await ensureLabelExists("bug");
    expect(mockExecGh).toHaveBeenCalledTimes(1);
  });

  it("ensureLabelExists passes color and description", async () => {
    mockExecGh.mockResolvedValueOnce("[]"); // list call
    await ensureLabelExists("label", "ff0000", "A label");
    expect(mockExecGh).toHaveBeenNthCalledWith(2, [
      "label",
      "create",
      "label",
      "--color",
      "ff0000",
      "--description",
      "A label",
      "--force",
    ]);
  });

  describe("setBlockedStatus", () => {
    it("adds comment with block reason before applying label", async () => {
      await setBlockedStatus(42, "Quality gate failed: tests not passing");
      expect(mockAddComment).toHaveBeenCalledWith(
        42,
        "🚫 **Blocked**: Quality gate failed: tests not passing",
      );
    });

    it("applies status:blocked label after comment", async () => {
      await setBlockedStatus(42, "Merge conflict detected");
      expect(mockExecGh).toHaveBeenCalledWith([
        "issue",
        "edit",
        "42",
        "--add-label",
        "status:blocked",
      ]);
    });

    it("calls addComment before setLabel", async () => {
      const callOrder: string[] = [];
      mockAddComment.mockImplementation(async () => {
        callOrder.push("comment");
      });
      mockExecGh.mockImplementation(async () => {
        callOrder.push("label");
        return "";
      });

      await setBlockedStatus(42, "Test reason");
      expect(callOrder).toEqual(["comment", "label"]);
    });
  });
});

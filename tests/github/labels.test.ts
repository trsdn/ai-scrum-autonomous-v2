import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/github/issues.js", () => ({
  execGh: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { execGh } from "../../src/github/issues.js";
import {
  setLabel,
  removeLabel,
  getLabels,
  ensureLabelExists,
} from "../../src/github/labels.js";

const mockExecGh = vi.mocked(execGh);

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
    mockExecGh
      .mockResolvedValueOnce("[]") // first list call
      .mockResolvedValueOnce("[]"); // second list call
    await ensureLabelExists("new-label");
    expect(mockExecGh).toHaveBeenCalledTimes(3);
    expect(mockExecGh).toHaveBeenNthCalledWith(3, [
      "label",
      "create",
      "new-label",
      "--force",
    ]);
  });

  it("ensureLabelExists skips creation when label exists", async () => {
    mockExecGh
      .mockResolvedValueOnce('[{"name": "bug"}]') // first list call
      .mockResolvedValueOnce('[{"name": "bug"}]'); // second list call
    await ensureLabelExists("bug");
    expect(mockExecGh).toHaveBeenCalledTimes(2);
  });

  it("ensureLabelExists passes color and description", async () => {
    mockExecGh
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce("[]");
    await ensureLabelExists("label", "ff0000", "A label");
    expect(mockExecGh).toHaveBeenNthCalledWith(3, [
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
});

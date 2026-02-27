import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  diffStat,
  getChangedFiles,
  isNewOrModified,
} from "../../src/git/diff-analysis.js";

const execFile = promisify(execFileCb);

describe("diff-analysis", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();

    // Create a temporary directory with a real git repo
    repoDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "git-diff-analysis-test-"),
    );
    process.chdir(repoDir);

    // Initialize a git repo with an initial commit on main
    await execFile("git", ["init", "-b", "main"]);
    await execFile("git", ["config", "user.email", "test@test.com"]);
    await execFile("git", ["config", "user.name", "Test"]);
    await fs.writeFile(path.join(repoDir, "README.md"), "# Test\n");
    await fs.writeFile(path.join(repoDir, "existing.txt"), "line1\nline2\n");
    await execFile("git", ["add", "."]);
    await execFile("git", ["commit", "-m", "initial commit"]);

    // Create a feature branch with changes
    await execFile("git", ["checkout", "-b", "feature/diff-test"]);
    await fs.writeFile(path.join(repoDir, "new-file.ts"), "export const x = 1;\n");
    await fs.writeFile(
      path.join(repoDir, "existing.txt"),
      "line1\nline2\nline3\n",
    );
    await execFile("git", ["add", "."]);
    await execFile("git", ["commit", "-m", "add changes"]);

    // Go back to main
    await execFile("git", ["checkout", "main"]);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  describe("diffStat", () => {
    it("returns correct lines and files changed", async () => {
      const stat = await diffStat("feature/diff-test", "main");

      expect(stat.filesChanged).toBe(2);
      expect(stat.files).toContain("new-file.ts");
      expect(stat.files).toContain("existing.txt");
      expect(stat.linesChanged).toBeGreaterThan(0);
    });

    it("returns zero changes for identical branches", async () => {
      // Create a branch at the same point as main
      await execFile("git", ["branch", "feature/same", "main"]);

      const stat = await diffStat("feature/same", "main");

      expect(stat.filesChanged).toBe(0);
      expect(stat.linesChanged).toBe(0);
      expect(stat.files).toEqual([]);
    });
  });

  describe("getChangedFiles", () => {
    it("returns changed file paths between branches", async () => {
      const files = await getChangedFiles("feature/diff-test", "main");

      expect(files).toContain("new-file.ts");
      expect(files).toContain("existing.txt");
      expect(files).toHaveLength(2);
    });

    it("returns empty array when no changes", async () => {
      await execFile("git", ["branch", "feature/noop", "main"]);

      const files = await getChangedFiles("feature/noop", "main");
      expect(files).toEqual([]);
    });
  });

  describe("isNewOrModified", () => {
    it("returns true for a changed file", async () => {
      const result = await isNewOrModified(
        "new-file.ts",
        "feature/diff-test",
        "main",
      );
      expect(result).toBe(true);
    });

    it("returns true for a modified file", async () => {
      const result = await isNewOrModified(
        "existing.txt",
        "feature/diff-test",
        "main",
      );
      expect(result).toBe(true);
    });

    it("returns false for an untouched file", async () => {
      const result = await isNewOrModified(
        "README.md",
        "feature/diff-test",
        "main",
      );
      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("diffStat returns empty result for nonexistent branch", async () => {
      const stat = await diffStat("nonexistent-branch", "main");
      expect(stat.filesChanged).toBe(0);
      expect(stat.linesChanged).toBe(0);
      expect(stat.files).toEqual([]);
    });

    it("getChangedFiles returns empty array for nonexistent branch", async () => {
      const files = await getChangedFiles("nonexistent-branch", "main");
      expect(files).toEqual([]);
    });

    it("isNewOrModified returns false for nonexistent branch", async () => {
      const result = await isNewOrModified("README.md", "nonexistent-branch", "main");
      expect(result).toBe(false);
    });
  });
});

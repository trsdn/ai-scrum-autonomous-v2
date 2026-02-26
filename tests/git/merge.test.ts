import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mergeBranch, hasConflicts } from "../../src/git/merge.js";

const execFile = promisify(execFileCb);

describe("merge", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();

    repoDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "git-merge-test-")),
    );
    process.chdir(repoDir);

    await execFile("git", ["init", "-b", "main"]);
    await execFile("git", ["config", "user.email", "test@test.com"]);
    await execFile("git", ["config", "user.name", "Test"]);
    await fs.writeFile(path.join(repoDir, "README.md"), "# Test\n");
    await execFile("git", ["add", "."]);
    await execFile("git", ["commit", "-m", "initial commit"]);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  describe("mergeBranch", () => {
    it("performs a successful fast-forward merge", async () => {
      await execFile("git", ["checkout", "-b", "feature"]);
      await fs.writeFile(path.join(repoDir, "feature.txt"), "feature\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add feature"]);

      const result = await mergeBranch("feature", "main");

      expect(result.success).toBe(true);
      expect(result.conflictFiles).toBeUndefined();

      // Verify we're on main and the file exists
      const { stdout: branch } = await execFile("git", ["branch", "--show-current"]);
      expect(branch.trim()).toBe("main");
      const content = await fs.readFile(path.join(repoDir, "feature.txt"), "utf-8");
      expect(content).toBe("feature\n");
    });

    it("performs a squash merge combining multiple commits", async () => {
      await execFile("git", ["checkout", "-b", "feature-squash"]);
      await fs.writeFile(path.join(repoDir, "a.txt"), "a\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "commit 1"]);
      await fs.writeFile(path.join(repoDir, "b.txt"), "b\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "commit 2"]);

      const result = await mergeBranch("feature-squash", "main", { squash: true });

      expect(result.success).toBe(true);

      // Count commits on main: initial + squash = 2
      const { stdout: log } = await execFile("git", ["rev-list", "--count", "main"]);
      expect(parseInt(log.trim(), 10)).toBe(2);

      // Both files should exist
      const a = await fs.readFile(path.join(repoDir, "a.txt"), "utf-8");
      const b = await fs.readFile(path.join(repoDir, "b.txt"), "utf-8");
      expect(a).toBe("a\n");
      expect(b).toBe("b\n");
    });

    it("returns conflict info when branches conflict", async () => {
      // Create conflicting changes on two branches
      await fs.writeFile(path.join(repoDir, "conflict.txt"), "main change\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "main side"]);

      await execFile("git", ["checkout", "-b", "conflicting", "HEAD~1"]);
      await fs.writeFile(path.join(repoDir, "conflict.txt"), "branch change\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "branch side"]);

      const result = await mergeBranch("main", "conflicting");

      expect(result.success).toBe(false);
      expect(result.conflictFiles).toBeDefined();
      expect(result.conflictFiles!.length).toBeGreaterThan(0);
      expect(result.conflictFiles).toContain("conflict.txt");

      // Verify merge was aborted (clean working tree)
      const { stdout: status } = await execFile("git", ["status", "--porcelain"]);
      expect(status.trim()).toBe("");
    });

    it("throws when merging a non-existent branch", async () => {
      await expect(
        mergeBranch("nonexistent-branch", "main"),
      ).rejects.toThrow("Failed to merge");
    });
  });

  describe("hasConflicts", () => {
    it("returns true when branches have conflicting changes", async () => {
      await fs.writeFile(path.join(repoDir, "file.txt"), "main version\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "main edit"]);

      await execFile("git", ["checkout", "-b", "conflict-branch", "HEAD~1"]);
      await fs.writeFile(path.join(repoDir, "file.txt"), "branch version\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "branch edit"]);

      const conflicts = await hasConflicts("conflict-branch", "main");
      expect(conflicts).toBe(true);
    });

    it("returns false when branches have non-overlapping changes", async () => {
      await fs.writeFile(path.join(repoDir, "main-only.txt"), "main\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "main file"]);

      await execFile("git", ["checkout", "-b", "safe-branch", "HEAD~1"]);
      await fs.writeFile(path.join(repoDir, "branch-only.txt"), "branch\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "branch file"]);

      const conflicts = await hasConflicts("safe-branch", "main");
      expect(conflicts).toBe(false);
    });

    it("throws when checking conflicts with a non-existent branch", async () => {
      await expect(
        hasConflicts("nonexistent", "main"),
      ).rejects.toThrow("Failed to check conflicts");
    });
  });
});

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

  describe("branch contamination prevention (issue #81)", () => {
    it("resets target branch to clean state after merge to prevent contamination", async () => {
      // Create feature branch with changes
      await execFile("git", ["checkout", "-b", "feature-1"]);
      await fs.writeFile(path.join(repoDir, "feature1.txt"), "feature 1 content\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add feature 1"]);

      // Merge feature-1 to main WITH cleanup
      const result = await mergeBranch("feature-1", "main", { cleanup: true });
      expect(result.success).toBe(true);

      // Verify we're on main
      const { stdout: currentBranch } = await execFile("git", ["branch", "--show-current"]);
      expect(currentBranch.trim()).toBe("main");

      // Verify working directory is clean (no uncommitted changes)
      const { stdout: statusOutput } = await execFile("git", ["status", "--porcelain"]);
      expect(statusOutput.trim()).toBe("");

      // Verify new branch from main has no uncommitted contamination
      await execFile("git", ["checkout", "-b", "feature-2"]);
      const { stdout: statusOutput2 } = await execFile("git", ["status", "--porcelain"]);
      expect(statusOutput2.trim()).toBe("");

      // Verify feature-2 has the committed content from feature-1
      const { stdout: lsFiles } = await execFile("git", ["ls-files"]);
      expect(lsFiles).toContain("feature1.txt");
    });

    it("sequential merges do not contaminate subsequent branches", async () => {
      // Setup mock remote
      const remoteDir = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "git-remote-")),
      );
      await execFile("git", ["clone", "--bare", repoDir, remoteDir]);
      await execFile("git", ["remote", "add", "origin", remoteDir]);
      await execFile("git", ["fetch", "origin"]);
      await execFile("git", ["branch", "-u", "origin/main", "main"]);

      // Create and merge branch A
      await execFile("git", ["checkout", "-b", "branch-a"]);
      await fs.writeFile(path.join(repoDir, "file-a.txt"), "content A\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add file A"]);
      
      const resultA = await mergeBranch("branch-a", "main", { cleanup: true });
      expect(resultA.success).toBe(true);

      // Verify main is on the expected branch
      const { stdout: currentBranch } = await execFile("git", ["branch", "--show-current"]);
      expect(currentBranch.trim()).toBe("main");

      // Verify working directory is clean after merge
      const { stdout: statusAfterA } = await execFile("git", ["status", "--porcelain"]);
      expect(statusAfterA.trim()).toBe("");

      // Create branch B from main
      await execFile("git", ["checkout", "-b", "branch-b"]);
      
      // Verify branch B does NOT contain uncommitted changes
      const { stdout: statusB } = await execFile("git", ["status", "--porcelain"]);
      expect(statusB.trim()).toBe("");

      // Verify branch B has file-a.txt from merged commit
      const { stdout: lsFilesB } = await execFile("git", ["ls-files"]);
      expect(lsFilesB).toContain("file-a.txt");

      // Add changes to branch B
      await fs.writeFile(path.join(repoDir, "file-b.txt"), "content B\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add file B"]);

      const resultB = await mergeBranch("branch-b", "main", { cleanup: true });
      expect(resultB.success).toBe(true);

      // Verify main working directory is clean
      const { stdout: statusAfterB } = await execFile("git", ["status", "--porcelain"]);
      expect(statusAfterB.trim()).toBe("");

      // Create branch C from main
      await execFile("git", ["checkout", "-b", "branch-c"]);

      // Verify branch C is clean (no uncommitted changes)
      const { stdout: statusC } = await execFile("git", ["status", "--porcelain"]);
      expect(statusC.trim()).toBe("");

      // Verify branch C has both merged files
      const { stdout: lsFilesC } = await execFile("git", ["ls-files"]);
      expect(lsFilesC).toContain("file-a.txt");
      expect(lsFilesC).toContain("file-b.txt");

      // Cleanup
      await fs.rm(remoteDir, { recursive: true, force: true });
    });

    it("handles cleanup gracefully when remote is unavailable", async () => {
      // No remote setup - cleanup should not fail

      await execFile("git", ["checkout", "-b", "feature-no-remote"]);
      await fs.writeFile(path.join(repoDir, "file.txt"), "content\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add file"]);

      // Merge with cleanup enabled but no remote - should succeed gracefully
      const result = await mergeBranch("feature-no-remote", "main", {
        cleanup: true,
      });
      expect(result.success).toBe(true);

      // Verify we're on main
      const { stdout: branch } = await execFile("git", ["branch", "--show-current"]);
      expect(branch.trim()).toBe("main");
    });
  });
});

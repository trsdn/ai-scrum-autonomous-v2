import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
} from "../../src/git/worktree.js";

const execFile = promisify(execFileCb);

describe("worktree", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();

    // Create a temporary directory with a real git repo
    // Use realpath to resolve macOS /tmp -> /private/tmp symlinks
    repoDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "git-worktree-test-")),
    );
    process.chdir(repoDir);

    // Initialize a git repo with an initial commit
    await execFile("git", ["init"]);
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

  describe("createWorktree", () => {
    it("creates a worktree with a new branch from base", async () => {
      const worktreePath = path.join(repoDir, "wt-feature");

      await createWorktree({
        path: worktreePath,
        branch: "feature/test-1",
        base: "HEAD",
      });

      // Verify the worktree directory exists
      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      // Verify the branch exists
      const { stdout } = await execFile("git", ["branch", "--list", "feature/test-1"]);
      expect(stdout.trim()).toContain("feature/test-1");
    });

    it("reuses an existing branch by resetting it to base", async () => {
      // Simulate a leftover branch from a previous failed run
      await execFile("git", ["branch", "leftover-branch"]);

      // Add a new commit so base (HEAD) is ahead of the leftover branch
      await fs.writeFile(path.join(repoDir, "new-file.txt"), "new\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "second commit"]);

      const worktreePath = path.join(repoDir, "wt-reuse");
      await createWorktree({
        path: worktreePath,
        branch: "leftover-branch",
        base: "HEAD",
      });

      // Verify worktree was created
      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      // Verify the branch was reset to HEAD (should contain new-file.txt)
      const newFile = path.join(worktreePath, "new-file.txt");
      const content = await fs.readFile(newFile, "utf-8");
      expect(content).toBe("new\n");
    });

    it("recovers from a stale worktree at the same path", async () => {
      const worktreePath = path.join(repoDir, "wt-stale");

      // Create first worktree
      await createWorktree({
        path: worktreePath,
        branch: "branch-first",
        base: "HEAD",
      });

      // Manually delete the directory but leave git's worktree registry intact
      await fs.rm(worktreePath, { recursive: true, force: true });

      // Now create a second worktree at the same path — should not throw
      await createWorktree({
        path: worktreePath,
        branch: "branch-second",
        base: "HEAD",
      });

      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      const { stdout } = await execFile("git", ["branch", "--list", "branch-second"]);
      expect(stdout.trim()).toContain("branch-second");
    });

    it("recovers when both branch and worktree exist from a previous run", async () => {
      const worktreePath = path.join(repoDir, "wt-both");

      // First run: create worktree normally
      await createWorktree({
        path: worktreePath,
        branch: "sprint/1/issue-99",
        base: "HEAD",
      });

      // Simulate crash: worktree and branch both still exist
      // Second run: should reset branch and recreate worktree
      await createWorktree({
        path: worktreePath,
        branch: "sprint/1/issue-99",
        base: "HEAD",
      });

      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);
    });

    it("throws when the base ref does not exist", async () => {
      await expect(
        createWorktree({
          path: path.join(repoDir, "wt-bad"),
          branch: "new-branch",
          base: "nonexistent-ref",
        }),
      ).rejects.toThrow();
    });

    it("creates worktree with correct content from base", async () => {
      // Add a file on main
      await fs.writeFile(path.join(repoDir, "main-only.txt"), "main content\n");
      await execFile("git", ["add", "."]);
      await execFile("git", ["commit", "-m", "add main-only"]);

      const worktreePath = path.join(repoDir, "wt-content");
      await createWorktree({
        path: worktreePath,
        branch: "feature/content-test",
        base: "HEAD",
      });

      // Verify content is available in the worktree
      const content = await fs.readFile(path.join(worktreePath, "main-only.txt"), "utf-8");
      expect(content).toBe("main content\n");
    });

    it("cleans up branch when worktree creation fails", async () => {
      // Use an invalid path that git worktree add can't use
      // We'll create a regular file at the path so git can't make a directory there
      const blockerPath = path.join(repoDir, "wt-blocker");
      // Create nested so git worktree add fails trying to use a non-directory parent
      await fs.mkdir(blockerPath);
      // Put a .git file there to make it look like an existing worktree/repo
      await fs.writeFile(path.join(blockerPath, ".git"), "gitdir: /nonexistent\n");

      await expect(
        createWorktree({
          path: blockerPath,
          branch: "should-be-cleaned-up",
          base: "HEAD",
        }),
      ).rejects.toThrow();

      // Branch should have been cleaned up
      const { stdout } = await execFile("git", ["branch", "--list", "should-be-cleaned-up"]);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("removeWorktree", () => {
    it("removes an existing worktree", async () => {
      const worktreePath = path.join(repoDir, "wt-remove");

      await createWorktree({
        path: worktreePath,
        branch: "feature/remove-me",
        base: "HEAD",
      });

      await removeWorktree(worktreePath);

      // Verify the worktree directory is removed
      await expect(fs.stat(worktreePath)).rejects.toThrow();
    });

    it("throws when removing a non-existent worktree", async () => {
      await expect(
        removeWorktree(path.join(repoDir, "nonexistent")),
      ).rejects.toThrow();
    });

    it("removes worktree even with uncommitted changes (force)", async () => {
      const worktreePath = path.join(repoDir, "wt-dirty");

      await createWorktree({
        path: worktreePath,
        branch: "feature/dirty",
        base: "HEAD",
      });

      // Make uncommitted changes in the worktree
      await fs.writeFile(path.join(worktreePath, "dirty.txt"), "uncommitted\n");

      // Should still succeed (we use --force)
      await removeWorktree(worktreePath);
      await expect(fs.stat(worktreePath)).rejects.toThrow();
    });
  });

  describe("listWorktrees", () => {
    it("lists the main worktree", async () => {
      const worktrees = await listWorktrees();

      // At minimum, the main worktree should be listed
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
    });

    it("lists added worktrees", async () => {
      const worktreePath = path.join(repoDir, "wt-list");

      await createWorktree({
        path: worktreePath,
        branch: "feature/listed",
        base: "HEAD",
      });

      const worktrees = await listWorktrees();
      const found = worktrees.find((w) => w.branch === "feature/listed");

      expect(found).toBeDefined();
      expect(found!.path).toBe(worktreePath);
    });

    it("does not list removed worktrees", async () => {
      const worktreePath = path.join(repoDir, "wt-removed");

      await createWorktree({
        path: worktreePath,
        branch: "feature/gone",
        base: "HEAD",
      });
      await removeWorktree(worktreePath);

      const worktrees = await listWorktrees();
      const found = worktrees.find((w) => w.branch === "feature/gone");
      expect(found).toBeUndefined();
    });

    it("lists multiple worktrees simultaneously", async () => {
      await createWorktree({ path: path.join(repoDir, "wt-a"), branch: "branch-a", base: "HEAD" });
      await createWorktree({ path: path.join(repoDir, "wt-b"), branch: "branch-b", base: "HEAD" });
      await createWorktree({ path: path.join(repoDir, "wt-c"), branch: "branch-c", base: "HEAD" });

      const worktrees = await listWorktrees();
      const branches = worktrees.map((w) => w.branch);

      expect(branches).toContain("branch-a");
      expect(branches).toContain("branch-b");
      expect(branches).toContain("branch-c");
    });
  });

  describe("full lifecycle", () => {
    it("create → remove → recreate at same path works", async () => {
      const worktreePath = path.join(repoDir, "wt-lifecycle");

      await createWorktree({ path: worktreePath, branch: "cycle-1", base: "HEAD" });
      await removeWorktree(worktreePath);
      await createWorktree({ path: worktreePath, branch: "cycle-2", base: "HEAD" });

      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      const worktrees = await listWorktrees();
      expect(worktrees.find((w) => w.branch === "cycle-2")).toBeDefined();
      expect(worktrees.find((w) => w.branch === "cycle-1")).toBeUndefined();
    });

    it("simulates crash-resume: create → crash (no cleanup) → create again", async () => {
      const worktreePath = path.join(repoDir, "wt-crash");

      // First run creates worktree
      await createWorktree({ path: worktreePath, branch: "sprint/2/issue-1", base: "HEAD" });

      // Crash: no removeWorktree called. Branch and worktree both survive.
      // Resume: try to create the same worktree again
      await createWorktree({ path: worktreePath, branch: "sprint/2/issue-1", base: "HEAD" });

      // Should succeed — worktree is usable
      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      // Should appear exactly once in worktree list
      const worktrees = await listWorktrees();
      const matches = worktrees.filter((w) => w.branch === "sprint/2/issue-1");
      expect(matches).toHaveLength(1);
    });
  });
});

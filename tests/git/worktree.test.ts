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

    it("throws when the branch already exists", async () => {
      await execFile("git", ["branch", "existing-branch"]);

      await expect(
        createWorktree({
          path: path.join(repoDir, "wt-dup"),
          branch: "existing-branch",
          base: "HEAD",
        }),
      ).rejects.toThrow("already exists");
    });

    it("throws when the worktree path already exists as a worktree", async () => {
      const worktreePath = path.join(repoDir, "wt-dup-path");

      await createWorktree({
        path: worktreePath,
        branch: "branch-a",
        base: "HEAD",
      });

      await expect(
        createWorktree({
          path: worktreePath,
          branch: "branch-b",
          base: "HEAD",
        }),
      ).rejects.toThrow("already exists");
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
  });
});

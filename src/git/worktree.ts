// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import type { Worktree } from "../types.js";

const execFile = promisify(execFileCb);

export interface CreateWorktreeOptions {
  path: string;
  branch: string;
  base: string;
}

/**
 * Create a new branch from base and add a worktree at the given path.
 * If the branch already exists (e.g. from a previous failed run), it is
 * reset to the base ref so the worktree starts clean.
 */
export async function createWorktree(
  options: CreateWorktreeOptions,
): Promise<void> {
  const { path, branch, base } = options;
  const log = logger.child({ module: "worktree" });

  // Remove stale worktree first (must happen before branch reset)
  try {
    await execFile("git", ["worktree", "remove", path, "--force"]);
    log.debug({ path }, "removed stale worktree");
  } catch {
    // No existing worktree at this path — that's fine
  }

  try {
    // Create branch from base
    await execFile("git", ["branch", branch, base]);
    log.debug({ branch, base }, "created branch");
  } catch (err: unknown) {
    const message = (err as Error).message ?? "";
    if (message.includes("already exists")) {
      // Branch left over from a previous run — reset it to base
      log.info({ branch, base }, "branch already exists — resetting to base");
      await execFile("git", ["branch", "-f", branch, base]);
    } else {
      throw new Error(`Failed to create branch '${branch}': ${message}`);
    }
  }

  try {
    // Add worktree at path for the new branch
    await execFile("git", ["worktree", "add", path, branch]);
    log.info({ path, branch }, "worktree created");
  } catch (err: unknown) {
    const message = (err as Error).message ?? "";
    // Clean up the branch on any failure
    await execFile("git", ["branch", "-D", branch]).catch(() => {});
    throw new Error(`Failed to add worktree at '${path}': ${message}`);
  }
}

/**
 * Remove a worktree (keeps the branch).
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  const log = logger.child({ module: "worktree" });

  try {
    await execFile("git", ["worktree", "remove", worktreePath, "--force"]);
    log.info({ path: worktreePath }, "worktree removed");
  } catch (err: unknown) {
    const message = (err as Error).message ?? "";
    throw new Error(
      `Failed to remove worktree at '${worktreePath}': ${message}`,
    );
  }
}

/**
 * Delete a local git branch.
 */
export async function deleteBranch(
  branch: string,
  force: boolean = true,
): Promise<void> {
  const log = logger.child({ module: "worktree" });
  const flag = force ? "-D" : "-d";
  await execFile("git", ["branch", flag, branch]);
  log.debug({ branch }, "deleted branch");
}

/**
 * List all active worktrees with their branches.
 */
export async function listWorktrees(): Promise<Worktree[]> {
  const log = logger.child({ module: "worktree" });

  const { stdout } = await execFile("git", [
    "worktree",
    "list",
    "--porcelain",
  ]);

  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};

  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "") {
      if (current.path && current.branch) {
        worktrees.push({
          path: current.path,
          branch: current.branch,
          issueNumber: 0,
        });
      }
      current = {};
    }
  }

  log.debug({ count: worktrees.length }, "listed worktrees");
  return worktrees;
}

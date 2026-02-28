import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { execGh } from "../github/issues.js";
import { logger } from "../logger.js";

const execFile = promisify(execFileCb);

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
}

export interface PRMergeResult {
  success: boolean;
  prNumber?: number;
  reason?: string;
}

export interface PRStats {
  prNumber: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/**
 * Fetch PR stats (additions/deletions/files) for a branch.
 * Returns undefined if no open or merged PR found.
 */
export async function getPRStats(branch: string): Promise<PRStats | undefined> {
  const log = logger.child({ module: "merge" });
  try {
    const json = await execGh([
      "pr", "list",
      "--head", branch,
      "--state", "all",
      "--json", "number,additions,deletions,changedFiles",
      "--limit", "1",
    ]);
    const prs = JSON.parse(json) as PRStats[];
    if (prs.length > 0) {
      return prs[0]!;
    }
  } catch (err: unknown) {
    log.debug({ branch, err }, "Could not fetch PR stats");
  }
  return undefined;
}

/**
 * Find and merge a PR by its head branch name using `gh pr merge`.
 * Returns success: false if no PR found or merge fails.
 */
export async function mergeIssuePR(
  branch: string,
  options: { squash?: boolean; deleteBranch?: boolean } = {},
): Promise<PRMergeResult> {
  const log = logger.child({ module: "merge" });

  // Find PR by head branch
  let prNumber: number | undefined;
  try {
    const json = await execGh([
      "pr", "list",
      "--head", branch,
      "--state", "open",
      "--json", "number",
      "--limit", "1",
    ]);
    const prs = JSON.parse(json) as { number: number }[];
    if (prs.length > 0) {
      prNumber = prs[0]!.number;
    }
  } catch (err: unknown) {
    log.warn({ branch, err }, "Failed to find PR for branch");
    return { success: false, reason: "Could not find PR for branch" };
  }

  if (!prNumber) {
    log.info({ branch }, "No open PR found for branch — skipping merge");
    return { success: false, reason: "No open PR found" };
  }

  // Merge via gh CLI
  const args = ["pr", "merge", String(prNumber)];
  if (options.squash) {
    args.push("--squash");
  } else {
    args.push("--merge");
  }
  if (options.deleteBranch) {
    args.push("--delete-branch");
  }

  try {
    await execGh(args);
    log.info({ prNumber, branch, squash: options.squash }, "PR merged via GitHub");
    return { success: true, prNumber };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ prNumber, branch, err: message }, "PR merge failed");
    return { success: false, prNumber, reason: message };
  }
}

/**
 * Merge source branch into target branch with conflict detection.
 */
export async function mergeBranch(
  source: string,
  target: string,
  options: { squash?: boolean } = {},
): Promise<MergeResult> {
  const log = logger.child({ module: "merge" });

  // Fetch latest from remote before merging to avoid losing remote changes
  try {
    await execFile("git", ["fetch", "origin", target]);
  } catch {
    log.debug({ target }, "git fetch failed — proceeding with local state");
  }

  // Checkout target branch
  await execFile("git", ["checkout", target]);

  const args = ["merge", source, "--no-edit"];
  if (options.squash) {
    args.push("--squash");
  }

  try {
    await execFile("git", args);

    // For squash merges, we need to commit the result
    if (options.squash) {
      await execFile("git", [
        "commit",
        "-m",
        `Squash merge branch '${source}' into ${target}`,
        "--no-edit",
      ]);
    }

    log.info({ source, target, squash: options.squash }, "merge succeeded");
    return { success: true };
  } catch (err: unknown) {
    const message = (err as Error).message ?? "";
    const stdout = (err as { stdout?: string }).stdout ?? "";
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const output = `${message}\n${stdout}\n${stderr}`;

    if (output.includes("CONFLICT") || output.includes("Merge conflict")) {
      // Gather conflict file list
      const conflictFiles = await getConflictFiles();
      log.warn(
        { source, target, conflictFiles },
        "merge produced conflicts",
      );

      // Abort the failed merge
      await execFile("git", ["merge", "--abort"]).catch((err) => log.debug({ err: String(err) }, "merge --abort failed (non-critical)"));
      return { success: false, conflictFiles };
    }

    // Abort any partial merge state
    await execFile("git", ["merge", "--abort"]).catch((err) => log.debug({ err: String(err) }, "merge --abort cleanup failed"));
    throw new Error(
      `Failed to merge '${source}' into '${target}': ${message}`,
    );
  }
}

/**
 * Pre-merge conflict check without modifying the working tree.
 * Uses git merge-tree to detect conflicts.
 */
export async function hasConflicts(
  source: string,
  target: string,
): Promise<boolean> {
  const log = logger.child({ module: "merge" });

  try {
    // Find the merge base
    const { stdout: mergeBase } = await execFile("git", [
      "merge-base",
      target,
      source,
    ]);
    const base = mergeBase.trim();

    // Use merge-tree to simulate the merge
    const { stdout } = await execFile("git", [
      "merge-tree",
      base,
      target,
      source,
    ]);

    // merge-tree outputs conflict markers when there are conflicts
    const conflicts = stdout.includes("<<<<<<");
    log.debug({ source, target, conflicts }, "conflict check complete");
    return conflicts;
  } catch (err: unknown) {
    const message = (err as Error).message ?? "";
    throw new Error(
      `Failed to check conflicts between '${source}' and '${target}': ${message}`,
    );
  }
}

async function getConflictFiles(): Promise<string[]> {
  try {
    const { stdout } = await execFile("git", ["diff", "--name-only", "--diff-filter=U"]);
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

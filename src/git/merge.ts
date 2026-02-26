import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";

const execFile = promisify(execFileCb);

export interface MergeResult {
  success: boolean;
  conflictFiles?: string[];
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
      await execFile("git", ["merge", "--abort"]).catch(() => {});
      return { success: false, conflictFiles };
    }

    // Abort any partial merge state
    await execFile("git", ["merge", "--abort"]).catch(() => {});
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

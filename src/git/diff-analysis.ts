import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import type { DiffStat } from "../types.js";

const execFile = promisify(execFileCb);

/**
 * Get lines changed, files changed between two branches.
 */
export async function diffStat(
  branch: string,
  base: string,
): Promise<DiffStat> {
  const log = logger.child({ module: "diff-analysis" });

  let stdout: string;
  try {
    const result = await execFile("git", [
      "diff",
      "--numstat",
      `${base}...${branch}`,
    ]);
    stdout = result.stdout;
  } catch (err: unknown) {
    log.warn({ branch, base, err }, "git diff failed — returning empty diff");
    return { linesChanged: 0, filesChanged: 0, files: [] };
  }

  const files: string[] = [];
  let linesChanged = 0;

  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [added, deleted, filePath] = parts;
    // Binary files show '-' for added/deleted
    const addedNum = added === "-" ? 0 : parseInt(added, 10);
    const deletedNum = deleted === "-" ? 0 : parseInt(deleted, 10);
    linesChanged += addedNum + deletedNum;
    files.push(filePath!);
  }

  const result: DiffStat = {
    linesChanged,
    filesChanged: files.length,
    files,
  };

  log.debug({ branch, base, ...result }, "diff stat computed");
  return result;
}

/**
 * List changed file paths between a branch and an optional base.
 * If base is omitted, diffs against HEAD.
 */
export async function getChangedFiles(
  branch: string,
  base?: string,
): Promise<string[]> {
  const log = logger.child({ module: "diff-analysis" });

  // Ensure we have the latest refs before comparing
  try {
    await execFile("git", ["fetch", "origin", "--quiet"]);
  } catch {
    // Non-critical — proceed with local refs
  }

  const rangeSpec = base ? `${base}...${branch}` : branch;
  let stdout: string;
  try {
    const result = await execFile("git", [
      "diff",
      "--name-only",
      rangeSpec,
    ]);
    stdout = result.stdout;
  } catch (err: unknown) {
    log.warn({ branch, base, err }, "git diff failed — returning empty file list");
    return [];
  }

  const files = stdout
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);

  log.debug({ branch, base, count: files.length }, "changed files listed");
  return files;
}

/**
 * Check if a specific file was changed between a branch and an optional base.
 */
export async function isNewOrModified(
  filePath: string,
  branch: string,
  base?: string,
): Promise<boolean> {
  const files = await getChangedFiles(branch, base);
  return files.includes(filePath);
}

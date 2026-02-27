import { execGh } from "../github/issues.js";
import { addComment } from "../github/issues.js";
import { listPullRequests } from "../github/pull-requests.js";
import { logger } from "../logger.js";
import type { SprintConfig } from "../types.js";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_POLL_INTERVAL_MS = 15_000; // 15 seconds

export interface CiCheckResult {
  allGreen: boolean;
  checks: Array<{ name: string; status: string; conclusion: string }>;
}

export interface MergeResult {
  merged: boolean;
  prNumber: number;
  error?: string;
}

/**
 * Poll `gh run list` until all checks pass or timeout is reached.
 */
export async function waitForCiGreen(
  branch: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<CiCheckResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const raw = await execGh([
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      "3",
      "--json",
      "status,conclusion,name",
    ]);

    let checks: Array<{ name: string; status: string; conclusion: string }>;
    try {
      checks = JSON.parse(raw) as Array<{
        name: string;
        status: string;
        conclusion: string;
      }>;
    } catch {
      logger.warn({ branch }, "Failed to parse CI check response, retrying…");
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (checks.length === 0) {
      logger.debug({ branch }, "No CI runs found yet, retrying…");
    } else {
      const allCompleted = checks.every((c) => c.status === "completed");
      const allGreen = allCompleted && checks.every((c) => c.conclusion === "success");

      if (allCompleted) {
        logger.info({ branch, allGreen, count: checks.length }, "CI checks completed");
        return { allGreen, checks };
      }

      logger.debug(
        { branch, pending: checks.filter((c) => c.status !== "completed").length },
        "CI checks still running, polling again…",
      );
    }

    await sleep(pollIntervalMs);
  }

  // Timed out — return current state
  const raw = await execGh([
    "run",
    "list",
    "--branch",
    branch,
    "--limit",
    "3",
    "--json",
    "status,conclusion,name",
  ]);

  let checks: Array<{ name: string; status: string; conclusion: string }> = [];
  try {
    checks = JSON.parse(raw) as Array<{
      name: string;
      status: string;
      conclusion: string;
    }>;
  } catch {
    logger.warn({ branch }, "Failed to parse CI check response on timeout");
  }

  logger.warn({ branch, timeoutMs }, "CI check polling timed out");
  return {
    allGreen: false,
    checks,
  };
}

/**
 * Merge a PR via squash-merge after CI passes.
 */
export async function autoMergePr(
  prNumber: number,
  squash: boolean = true,
): Promise<MergeResult> {
  try {
    const args = ["pr", "merge", String(prNumber), "--delete-branch"];
    if (squash) {
      args.push("--squash");
    }

    await execGh(args);
    logger.info({ prNumber, squash }, "PR merged successfully");
    return { merged: true, prNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ prNumber, error: message }, "Failed to merge PR");
    return { merged: false, prNumber, error: message };
  }
}

/**
 * Post a formatted deployment status comment to an issue.
 */
export async function reportDeployStatus(
  issueNumber: number,
  status: "success" | "failure",
  details: string,
): Promise<void> {
  const emoji = status === "success" ? "✅" : "❌";
  const body = `## ${emoji} Deployment ${status}\n\n${details}`;
  await addComment(issueNumber, body);
  logger.info({ issueNumber, status }, "Deploy status reported");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PreSweepResult {
  merged: number[];
  skipped: Array<{ prNumber: number; reason: string }>;
}

/**
 * Sweep all sprint PRs and auto-merge those that are CI-green and mergeable.
 * Called before sprint review to ensure completed work is merged.
 */
export async function preSweepAutoMerge(
  config: SprintConfig,
  issueNumbers: number[],
): Promise<PreSweepResult> {
  const log = logger.child({ module: "pre-sweep-merge" });
  const merged: number[] = [];
  const skipped: Array<{ prNumber: number; reason: string }> = [];

  log.info({ issueCount: issueNumbers.length }, "Starting pre-review PR merge sweep");

  for (const issueNumber of issueNumbers) {
    const branch = config.branchPattern
      .replace("{prefix}", config.sprintSlug)
      .replace("{sprint}", String(config.sprintNumber))
      .replace("{issue}", String(issueNumber));

    try {
      // Find PRs matching this branch
      const prs = await listPullRequests({ head: branch, state: "open" });

      if (prs.length === 0) {
        log.debug({ issueNumber, branch }, "No open PRs found for issue");
        continue;
      }

      // Take first PR (should only be one)
      const pr = prs[0];
      log.debug({ issueNumber, prNumber: pr.number, mergeState: pr.mergeStateStatus }, "Found PR");

      // Check if PR is mergeable
      if (pr.mergeStateStatus !== "CLEAN") {
        skipped.push({
          prNumber: pr.number,
          reason: `Merge state not clean: ${pr.mergeStateStatus}`,
        });
        log.debug({ prNumber: pr.number, mergeState: pr.mergeStateStatus }, "PR not mergeable");
        continue;
      }

      // Check CI status with short timeout (30s)
      const ciResult = await waitForCiGreen(branch, 30_000, 5_000);

      if (!ciResult.allGreen) {
        skipped.push({
          prNumber: pr.number,
          reason: "CI not green",
        });
        log.debug({ prNumber: pr.number, checks: ciResult.checks }, "CI checks not green");
        continue;
      }

      // Merge the PR
      const mergeResult = await autoMergePr(pr.number, config.squashMerge);

      if (mergeResult.merged) {
        merged.push(pr.number);
        log.info({ prNumber: pr.number, issueNumber }, "PR auto-merged");
      } else {
        skipped.push({
          prNumber: pr.number,
          reason: mergeResult.error ?? "Merge failed",
        });
        log.warn({ prNumber: pr.number, error: mergeResult.error }, "PR merge failed");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ issueNumber, branch, error: message }, "Error processing issue PR");
    }
  }

  log.info({ merged: merged.length, skipped: skipped.length }, "PR merge sweep complete");
  return { merged, skipped };
}

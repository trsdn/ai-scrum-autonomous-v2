// Copyright (c) 2025 trsdn. MIT License — see LICENSE for details.
import { execGh } from "../github/issues.js";
import { addComment } from "../github/issues.js";
import { logger } from "../logger.js";

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

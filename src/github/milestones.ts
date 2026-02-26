import { execGh } from "./issues.js";
import { logger } from "../logger.js";

export interface GitHubMilestone {
  title: string;
  number: number;
  description: string;
  state: string;
}

/** Create a new milestone. */
export async function createMilestone(
  title: string,
  description?: string,
): Promise<GitHubMilestone> {
  const args = [
    "api",
    "repos/{owner}/{repo}/milestones",
    "-f",
    `title=${title}`,
  ];

  if (description) {
    args.push("-f", `description=${description}`);
  }

  const json = await execGh(args);
  logger.info({ title }, "Milestone created");
  return JSON.parse(json) as GitHubMilestone;
}

/** Get a milestone by title. Returns undefined if not found. */
export async function getMilestone(
  title: string,
): Promise<GitHubMilestone | undefined> {
  const json = await execGh([
    "api",
    "repos/{owner}/{repo}/milestones",
    "--jq",
    `.[] | select(.title == "${title}")`,
  ]);

  if (!json) {
    return undefined;
  }

  return JSON.parse(json) as GitHubMilestone;
}

/** Assign an issue to a milestone by title. */
export async function setMilestone(
  issueNumber: number,
  milestoneTitle: string,
): Promise<void> {
  await execGh([
    "issue",
    "edit",
    String(issueNumber),
    "--milestone",
    milestoneTitle,
  ]);
  logger.debug({ issueNumber, milestoneTitle }, "Milestone set on issue");
}

/** Close a milestone by title. */
export async function closeMilestone(title: string): Promise<void> {
  const milestone = await getMilestone(title);
  if (!milestone) {
    throw new Error(`Milestone not found: ${title}`);
  }

  await execGh([
    "api",
    "-X",
    "PATCH",
    `repos/{owner}/{repo}/milestones/${milestone.number}`,
    "-f",
    "state=closed",
  ]);
  logger.info({ title }, "Milestone closed");
}

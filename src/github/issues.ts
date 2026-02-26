import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

/** Run a `gh` CLI command and return stdout. */
export async function execGh(args: string[]): Promise<string> {
  logger.debug({ args }, "gh %s", args[0]);
  try {
    const { stdout } = await execFileAsync("gh", args);
    return stdout.trim();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    logger.error({ args, error: message }, "gh command failed");
    throw new Error(`gh ${args.join(" ")} failed: ${message}`);
  }
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  state: string;
}

/** Get issue details by number. */
export async function getIssue(number: number): Promise<GitHubIssue> {
  const json = await execGh([
    "issue",
    "view",
    String(number),
    "--json",
    "number,title,body,labels,state",
  ]);
  return JSON.parse(json) as GitHubIssue;
}

export interface ListIssuesOptions {
  labels?: string[];
  state?: string;
  milestone?: string;
}

/** List issues with optional filters. */
export async function listIssues(
  options: ListIssuesOptions = {},
): Promise<GitHubIssue[]> {
  const args = [
    "issue",
    "list",
    "--json",
    "number,title,body,labels,state",
  ];

  if (options.labels && options.labels.length > 0) {
    args.push("--label", options.labels.join(","));
  }
  if (options.state) {
    args.push("--state", options.state);
  }
  if (options.milestone) {
    args.push("--milestone", options.milestone);
  }

  const json = await execGh(args);
  return JSON.parse(json) as GitHubIssue[];
}

export interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
}

/** Create a new issue and return its details. */
export async function createIssue(
  options: CreateIssueOptions,
): Promise<GitHubIssue> {
  const args = [
    "issue",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
  ];

  if (options.labels && options.labels.length > 0) {
    args.push("--label", options.labels.join(","));
  }

  const url = await execGh(args);
  // gh issue create returns the URL; extract number from it
  const match = url.match(/\/(\d+)\s*$/);
  if (!match) {
    throw new Error(`Could not parse issue number from: ${url}`);
  }
  return getIssue(Number(match[1]));
}

export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  state?: string;
}

/** Update an existing issue. */
export async function updateIssue(
  number: number,
  options: UpdateIssueOptions,
): Promise<void> {
  const args = ["issue", "edit", String(number)];

  if (options.title) {
    args.push("--title", options.title);
  }
  if (options.body) {
    args.push("--body", options.body);
  }

  await execGh(args);

  if (options.state === "closed") {
    await execGh(["issue", "close", String(number)]);
  } else if (options.state === "open") {
    await execGh(["issue", "reopen", String(number)]);
  }
}

/** Add a comment to an issue. */
export async function addComment(
  number: number,
  body: string,
): Promise<void> {
  await execGh(["issue", "comment", String(number), "--body", body]);
}

/** Close an issue. */
export async function closeIssue(number: number): Promise<void> {
  await execGh(["issue", "close", String(number)]);
}

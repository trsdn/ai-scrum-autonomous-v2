import { execGh } from "./issues.js";

export interface GitHubPullRequest {
  number: number;
  headRefName: string;
  state: string;
  mergeStateStatus: string;
  url: string;
}

export interface ListPullRequestsOptions {
  state?: "open" | "closed" | "all";
  base?: string;
  head?: string;
}

/**
 * List pull requests using gh CLI.
 * Returns an array of PR objects with number, head branch, state, and merge status.
 */
export async function listPullRequests(
  options?: ListPullRequestsOptions,
): Promise<GitHubPullRequest[]> {
  const args = ["pr", "list"];

  if (options?.state) {
    args.push("--state", options.state);
  }

  if (options?.base) {
    args.push("--base", options.base);
  }

  if (options?.head) {
    args.push("--head", options.head);
  }

  args.push("--json", "number,headRefName,state,mergeStateStatus,url");

  const raw = await execGh(args);
  return JSON.parse(raw) as GitHubPullRequest[];
}

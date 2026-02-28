import { createIssue, type CreateIssueOptions, type GitHubIssue } from "./issues.js";
import { logger } from "../logger.js";

export interface IssueCreationState {
  issuesCreatedCount: number;
}

/**
 * Rate-limited issue creator that enforces a per-sprint cap on issue creation.
 * Returns null if the limit is reached, otherwise creates the issue and increments the counter.
 */
export async function createIssueRateLimited(
  options: CreateIssueOptions,
  state: IssueCreationState,
  maxIssuesCreatedPerSprint: number,
): Promise<GitHubIssue | null> {
  const log = logger.child({ module: "issue-rate-limiter" });

  if (state.issuesCreatedCount >= maxIssuesCreatedPerSprint) {
    log.warn(
      {
        title: options.title,
        currentCount: state.issuesCreatedCount,
        limit: maxIssuesCreatedPerSprint,
      },
      "Issue creation rate limit reached — skipping issue creation",
    );
    return null;
  }

  const issue = await createIssue(options);
  state.issuesCreatedCount++;
  
  log.debug(
    {
      number: issue.number,
      count: state.issuesCreatedCount,
      limit: maxIssuesCreatedPerSprint,
    },
    "Issue created successfully",
  );

  return issue;
}

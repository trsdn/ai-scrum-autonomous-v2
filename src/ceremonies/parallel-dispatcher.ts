import pLimit from "p-limit";
import type { AcpClient } from "../acp/client.js";
import type {
  SprintConfig,
  SprintPlan,
  SprintResult,
  IssueResult,
} from "../types.js";
import { buildExecutionGroups } from "./dep-graph.js";
import { executeIssue } from "./execution.js";
import { mergeBranch } from "../git/merge.js";
import { setLabel } from "../github/labels.js";
import { logger } from "../logger.js";

import type { SprintEventBus } from "../tui/events.js";

/**
 * Execute sprint issues in parallel, respecting dependency groups.
 * Groups run sequentially; issues within a group run concurrently
 * up to config.maxParallelSessions.
 */
export async function runParallelExecution(
  client: AcpClient,
  config: SprintConfig,
  plan: SprintPlan,
  eventBus?: SprintEventBus,
): Promise<SprintResult> {
  const log = logger.child({ ceremony: "parallel-dispatcher" });
  const groups = buildExecutionGroups(plan.sprint_issues);
  const allResults: IssueResult[] = [];
  let mergeConflicts = 0;

  const issueMap = new Map(plan.sprint_issues.map((i) => [i.number, i]));

  for (const group of groups) {
    log.info({ group: group.group, issues: group.issues }, "executing group");

    const limit = pLimit(config.maxParallelSessions);

    const settled = await Promise.allSettled(
      group.issues.map((issueNumber) =>
        limit(async () => {
          const issue = issueMap.get(issueNumber);
          if (!issue) {
            throw new Error(`Issue #${issueNumber} not found in sprint plan`);
          }
          return executeIssue(client, config, issue, eventBus);
        }),
      ),
    );

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        const result = outcome.value;
        allResults.push(result);

        // Merge successful branches back to base
        if (config.autoMerge && result.status === "completed") {
          try {
            const mergeResult = await mergeBranch(result.branch, config.baseBranch, {
              squash: config.squashMerge,
            });

            if (!mergeResult.success) {
              mergeConflicts++;
              log.warn(
                { issue: result.issueNumber, branch: result.branch, conflictFiles: mergeResult.conflictFiles },
                "merge conflict — marking as failed",
              );
              result.status = "failed";
              result.qualityGatePassed = false;
              await setLabel(result.issueNumber, "status:blocked");
            } else {
              log.info({ issue: result.issueNumber, branch: result.branch }, "merged to base");
            }
          } catch (err: unknown) {
            mergeConflicts++;
            log.error({ issue: result.issueNumber, err }, "merge error");
            result.status = "failed";
            result.qualityGatePassed = false;
          }
        }
      } else {
        const issueNumber = group.issues[i];
        log.error({ issueNumber, err: outcome.reason }, "issue execution rejected");
        allResults.push({
          issueNumber,
          status: "failed",
          qualityGatePassed: false,
          qualityDetails: { passed: false, checks: [] },
          branch: `sprint/${config.sprintNumber}/issue-${issueNumber}`,
          duration_ms: 0,
          filesChanged: [],
          retryCount: 0,
          points: issueMap.get(issueNumber)?.points ?? 0,
        });
      }
    }

    // Check for critical failures after group
    const groupResults = allResults.slice(-group.issues.length);
    const failures = groupResults.filter((r) => r.status === "failed");
    if (failures.length === group.issues.length && group.issues.length > 0) {
      log.warn(
        { group: group.group, failureCount: failures.length },
        "all issues in group failed — pausing execution",
      );
      break;
    }
  }

  const totalGroupSize = groups.reduce((sum, g) => sum + g.issues.length, 0);
  const parallelizationRatio =
    groups.length > 0 ? totalGroupSize / groups.length : 1;

  const durations = allResults.map((r) => r.duration_ms);
  const avgWorktreeLifetime =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

  return {
    results: allResults,
    sprint: plan.sprintNumber,
    parallelizationRatio,
    avgWorktreeLifetime,
    mergeConflicts,
  };
}

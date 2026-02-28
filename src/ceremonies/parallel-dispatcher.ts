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
import { mergeIssuePR } from "../git/merge.js";
import { verifyMainBranch } from "../enforcement/quality-gate.js";
import { buildQualityGateConfig } from "./quality-retry.js";
import { escalateToStakeholder } from "../enforcement/escalation.js";
import { setLabel } from "../github/labels.js";
import { addComment } from "../github/issues.js";
import { logger } from "../logger.js";

import type { SprintEventBus } from "../events.js";

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

        // Merge successful branches back to base via GitHub PR
        if (config.autoMerge && result.status === "completed") {
          try {
            const mergeResult = await mergeIssuePR(result.branch, {
              squash: config.squashMerge,
              deleteBranch: config.deleteBranchAfterMerge,
            });

            if (!mergeResult.success) {
              mergeConflicts++;
              log.warn(
                { issue: result.issueNumber, branch: result.branch, reason: mergeResult.reason },
                "PR merge failed — marking as failed",
              );
              result.status = "failed";
              result.qualityGatePassed = false;
              await setLabel(result.issueNumber, "status:blocked");
              await addComment(result.issueNumber, `**Block reason:** PR merge failed — ${mergeResult.reason ?? "unknown"}`).catch((err) => log.warn({ err: String(err), issue: result.issueNumber }, "failed to post block reason comment"));
            } else {
              log.info({ issue: result.issueNumber, branch: result.branch, pr: mergeResult.prNumber }, "PR merged");

              // Post-merge verification: run tests + types on main to catch combinatorial breakage
              try {
                const gateConfig = buildQualityGateConfig(config);
                const verifyResult = await verifyMainBranch(config.projectPath, gateConfig);
                if (!verifyResult.passed) {
                  const failedChecks = verifyResult.checks.filter((c) => !c.passed).map((c) => c.name).join(", ");
                  log.error({ issue: result.issueNumber, failedChecks }, "post-merge verification FAILED on main");
                  await escalateToStakeholder({
                    level: "must",
                    reason: `Post-merge verification failed after merging #${result.issueNumber}`,
                    detail: `Failed checks: ${failedChecks}. Main branch may be broken.`,
                    context: { issueNumber: result.issueNumber, branch: result.branch },
                    timestamp: new Date(),
                  }, { ntfyEnabled: false }, eventBus);
                }
              } catch (verifyErr: unknown) {
                log.warn({ err: verifyErr }, "post-merge verification could not run");
              }
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
          branch: config.branchPattern
            .replace("{prefix}", config.sprintSlug)
            .replace("{sprint}", String(config.sprintNumber))
            .replace("{issue}", String(issueNumber)),
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
        "all issues in group failed — escalating to stakeholder",
      );

      // Escalate with ntfy notification
      const failedIssueNumbers = failures.map((f) => `#${f.issueNumber}`).join(", ");
      await escalateToStakeholder({
        level: "must",
        reason: `All issues in execution group ${group.group} failed`,
        detail: `Failed issues: ${failedIssueNumbers}. Sprint execution paused until stakeholder intervenes. Unblock issues and resume to retry.`,
        context: { group: group.group, failures: failures.length },
        timestamp: new Date(),
      }, { ntfyEnabled: false }, eventBus);

      // Emit event so runner can handle pause
      eventBus?.emitTyped("sprint:error", {
        error: `All ${failures.length} issues in group ${group.group} failed. Execution paused — waiting for stakeholder.`,
      });

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

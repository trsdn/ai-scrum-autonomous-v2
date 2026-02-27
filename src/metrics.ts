import type { SprintResult, SprintMetrics } from "./types.js";

/**
 * Calculates a rounded integer percentage.
 * @param part - The numerator value
 * @param total - The denominator value
 * @returns Rounded percentage (0–100). Returns 0 when total is 0.
 */
export function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g. '500ms', '5s', '2m', '2m 30s')
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Calculates aggregate metrics for a completed sprint.
 * Computes counts (planned, completed, failed), story points,
 * velocity, average duration, first-pass rate, and drift incidents.
 * @param result - The sprint result containing all issue outcomes
 * @returns Computed sprint metrics
 */
export function calculateSprintMetrics(result: SprintResult): SprintMetrics {
  const { results } = result;
  const planned = results.length;
  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const pointsPlanned = results.reduce((sum, r) => sum + r.points, 0);
  const pointsCompleted = results
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.points, 0);
  const velocity = pointsCompleted;
  const avgDuration =
    planned > 0
      ? Math.round(results.reduce((sum, r) => sum + r.duration_ms, 0) / planned)
      : 0;
  const firstPassCount = results.filter((r) => r.retryCount === 0).length;
  const firstPassRate = percent(firstPassCount, planned);
  const driftIncidents = results.filter((r) =>
    r.qualityDetails.checks.some((c) => c.name === "scope_drift" && !c.passed),
  ).length;

  return {
    planned,
    completed,
    failed,
    pointsPlanned,
    pointsCompleted,
    velocity,
    avgDuration,
    firstPassRate,
    driftIncidents,
  };
}

/**
 * Returns the most commonly failed quality gates, sorted by frequency.
 * @param result - The sprint result containing quality check details
 * @returns Comma-separated string of gate names with counts (e.g. 'lint (2), tests (1)'),
 *          or an empty string if no gates failed.
 */
export function topFailedGates(result: SprintResult): string {
  const counts = new Map<string, number>();
  for (const issue of result.results) {
    for (const check of issue.qualityDetails.checks) {
      if (!check.passed) {
        counts.set(check.name, (counts.get(check.name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");
}

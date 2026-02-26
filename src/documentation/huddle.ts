import type { HuddleEntry } from "../types.js";

function statusIcon(status: "completed" | "failed"): string {
  return status === "completed" ? "✅" : "❌";
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatQualityChecks(entry: HuddleEntry): string {
  return entry.qualityResult.checks
    .map((c) => `  - ${c.passed ? "✅" : "❌"} ${c.name}: ${c.detail}`)
    .join("\n");
}

export function formatHuddleComment(entry: HuddleEntry): string {
  const icon = statusIcon(entry.status);
  const duration = formatDuration(entry.duration_ms);
  const qualityStatus = entry.qualityResult.passed ? "PASSED" : "FAILED";
  const checks = formatQualityChecks(entry);
  const files = entry.filesChanged.map((f) => `  - \`${f}\``).join("\n");
  const ts = entry.timestamp.toISOString();

  const lines = [
    `### ${icon} Huddle — #${entry.issueNumber} ${entry.issueTitle}`,
    "",
    `**Status**: ${entry.status} | **Duration**: ${duration} | **Quality**: ${qualityStatus}`,
    "",
    "**Quality Checks**:",
    checks,
    "",
    `**Files Changed** (${entry.filesChanged.length}):`,
    files,
  ];

  if (entry.cleanupWarning) {
    lines.push("", entry.cleanupWarning);
  }

  lines.push("", `_${ts}_`);
  return lines.join("\n");
}

export function formatSprintLogEntry(entry: HuddleEntry): string {
  const icon = statusIcon(entry.status);
  const duration = formatDuration(entry.duration_ms);
  const qualityStatus = entry.qualityResult.passed ? "PASSED" : "FAILED";
  const checks = formatQualityChecks(entry);
  const ts = entry.timestamp.toISOString();

  const lines = [
    `### ${icon} #${entry.issueNumber} — ${entry.issueTitle}`,
    "",
    `- **Status**: ${entry.status}`,
    `- **Duration**: ${duration}`,
    `- **Quality**: ${qualityStatus}`,
    `- **Files changed**: ${entry.filesChanged.length}`,
    "",
    "**Quality Checks**:",
    checks,
  ];

  if (entry.cleanupWarning) {
    lines.push("", entry.cleanupWarning);
  }

  lines.push("", `_${ts}_`);
  return lines.join("\n");
}

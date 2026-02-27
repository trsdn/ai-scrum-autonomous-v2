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
  ];

  if (entry.errorMessage) {
    lines.push("", `**Error**: ${entry.errorMessage}`);
  }

  if (entry.qualityResult.checks.length > 0) {
    lines.push("", "**Quality Checks**:", checks);
  } else if (entry.status === "failed") {
    lines.push("", "**Quality Checks**: _No diagnostic data available_");
  } else {
    lines.push("", "**Quality Checks**:", checks);
  }

  if (entry.codeReview) {
    const reviewIcon = entry.codeReview.approved ? "✅" : "⚠️";
    lines.push(
      "",
      `**Code Review**: ${reviewIcon} ${entry.codeReview.approved ? "APPROVED" : "CHANGES REQUESTED"}`,
    );
    if (entry.codeReview.issues.length > 0) {
      lines.push(...entry.codeReview.issues.map((i) => `  - ${i}`));
    }
  }

  lines.push(
    "",
    `**Files Changed** (${entry.filesChanged.length}):`,
    files,
  );

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
  ];

  if (entry.errorMessage) {
    lines.push(`- **Error**: ${entry.errorMessage}`);
  }

  if (entry.qualityResult.checks.length > 0) {
    lines.push("", "**Quality Checks**:", checks);
  } else if (entry.status === "failed") {
    lines.push("", "**Quality Checks**: _No diagnostic data available_");
  }

  if (entry.cleanupWarning) {
    lines.push("", entry.cleanupWarning);
  }

  lines.push("", `_${ts}_`);
  return lines.join("\n");
}

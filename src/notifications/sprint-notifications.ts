import type { SprintEventBus } from "../events.js";
import { sendNotification, type NtfyConfig } from "./ntfy.js";

const attachedBuses = new WeakSet<SprintEventBus>();

export function attachSprintNotifications(
  eventBus: SprintEventBus,
  ntfyConfig: NtfyConfig | undefined,
): void {
  if (attachedBuses.has(eventBus)) return;
  attachedBuses.add(eventBus);

  eventBus.onTyped("issue:fail", ({ issueNumber, reason }) => {
    sendNotification(
      ntfyConfig,
      "Issue Blocked",
      `Issue #${issueNumber} failed: ${reason}`,
      "high",
      ["warning"],
    );
  });

  eventBus.onTyped("sprint:complete", ({ sprintNumber }) => {
    sendNotification(
      ntfyConfig,
      "Sprint Complete",
      `Sprint ${sprintNumber} finished successfully`,
      "default",
      ["tada"],
    );
  });

  eventBus.onTyped("sprint:error", ({ error }) => {
    sendNotification(ntfyConfig, "Sprint Error", error, "urgent", ["rotating_light"]);
  });

  eventBus.onTyped("sprint:stopped", ({ sprintNumber }) => {
    sendNotification(
      ntfyConfig,
      "Sprint Stopped",
      `Sprint ${sprintNumber} was stopped by user`,
      "default",
      ["stop_sign"],
    );
  });

  eventBus.onTyped("sprint:cancelled", ({ sprintNumber, returnedIssues }) => {
    sendNotification(
      ntfyConfig,
      "Sprint Cancelled",
      `Sprint ${sprintNumber} cancelled. ${returnedIssues.length} issue(s) returned to backlog.`,
      "high",
      ["x"],
    );
  });
}

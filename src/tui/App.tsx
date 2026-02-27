import React from "react";
import { Box, useInput, useApp, useStdout } from "ink";
import type { SprintRunner } from "../runner.js";
import type { SprintPhase } from "../runner.js";
import { Header } from "./Header.js";
import { IssueList } from "./IssueList.js";
import type { IssueEntry } from "./IssueList.js";
import { ActivityPanel } from "./WorkerPanel.js";
import type { ActivityItem } from "./WorkerPanel.js";
import { LogPanel } from "./LogPanel.js";

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${rem.toString().padStart(2, "0")}s`;
}
import type { LogEntry } from "./LogPanel.js";
import { CommandBar } from "./CommandBar.js";

export interface AppProps {
  runner: SprintRunner;
  onStart?: () => void;
  initialIssues?: IssueEntry[];
}

export function App({ runner, onStart, initialIssues }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const initialState = runner.getState();

  // Build initial activities from saved state (for resume display)
  const buildInitialActivities = (): ActivityItem[] => {
    if (initialState.phase === "init") return [];
    const phaseOrder: SprintPhase[] = ["refine", "plan", "execute", "review", "retro"];
    const phaseLabels: Record<string, string> = {
      refine: "Refining backlog",
      plan: "Planning sprint",
      execute: "Executing issues",
      review: "Sprint review",
      retro: "Retrospective",
    };
    const items: ActivityItem[] = [];
    for (const p of phaseOrder) {
      if (p === initialState.phase) {
        // Current phase was interrupted — show as last completed
        items.push({ label: phaseLabels[p], status: "done", detail: "previous run" });
        break;
      }
      items.push({ label: phaseLabels[p], status: "done", detail: "previous run" });
    }
    return items;
  };

  const [phase, setPhase] = React.useState<SprintPhase>(initialState.phase);
  const [sprintNumber, setSprintNumber] = React.useState(initialState.sprintNumber);
  const [startedAt, setStartedAt] = React.useState(initialState.startedAt);
  const [issues, setIssues] = React.useState<IssueEntry[]>(initialIssues ?? []);
  const [activities, setActivities] = React.useState<ActivityItem[]>(buildInitialActivities());
  const [currentIssue, setCurrentIssue] = React.useState<number | null>(null);
  const [logEntries, setLogEntries] = React.useState<LogEntry[]>(() => {
    if (initialState.phase !== "init") {
      const time = new Date().toLocaleTimeString();
      const msg = initialState.phase === "failed"
        ? `Previous run failed: ${initialState.error ?? "unknown error"}`
        : `Loaded saved state — phase: ${initialState.phase}`;
      return [{ time, level: (initialState.phase === "failed" ? "error" : "info") as LogEntry["level"], message: msg }];
    }
    return [];
  });
  const [isPaused, setIsPaused] = React.useState(false);

  const completedCount = issues.filter((i) => i.status === "done").length;

  // Build activity list from phase transitions and events
  const addActivity = (label: string, status: ActivityItem["status"], detail?: string) => {
    setActivities((prev) => {
      // Mark previous active items as done (except issue-level items during execution)
      const updated = prev.map((a) =>
        a.status === "active" ? { ...a, status: "done" as const } : a,
      );
      return [...updated, { label, status, detail, startedAt: status === "active" ? Date.now() : undefined }];
    });
  };

  // Add activity without closing previous active items (for parallel work)
  const addParallelActivity = (label: string, status: ActivityItem["status"], detail?: string) => {
    setActivities((prev) => [
      ...prev,
      { label, status, detail, startedAt: status === "active" ? Date.now() : undefined },
    ]);
  };

  // Update an existing activity's detail (for progress updates)
  const updateActivity = (issueNumber: number, detail: string) => {
    setActivities((prev) =>
      prev.map((a) =>
        a.label.startsWith(`#${issueNumber} `) && a.status === "active"
          ? { ...a, detail }
          : a,
      ),
    );
  };

  React.useEffect(() => {
    const bus = runner.events;

    bus.onTyped("phase:change", ({ from, to, model, agent }) => {
      setPhase(to);
      if (to === "init" && (from === "complete" || from === "failed")) {
        setIssues([]);
        setActivities([]);
        setCurrentIssue(null);
        setStartedAt(new Date());
      }
      // Add activity for each phase
      if (to !== "init" && to !== "paused") {
        const labels: Record<string, string> = {
          refine: "Refining backlog",
          plan: "Planning sprint",
          execute: "Executing issues",
          review: "Sprint review",
          retro: "Retrospective",
          complete: "Sprint complete",
          failed: "Sprint failed",
        };
        const status = (to === "complete" || to === "failed") ? "done" as const : "active" as const;
        // Show agent role + model: "Planning Agent (claude-opus-4.6)"
        const detail = agent && model ? `${agent} (${model})` : agent ?? model;
        addActivity(labels[to] ?? to, status, detail);
      }
    });

    bus.onTyped("issue:start", ({ issue, model }) => {
      setCurrentIssue(issue.number);
      setIssues((prev) => {
        const exists = prev.some((i) => i.number === issue.number);
        if (exists) {
          return prev.map((i) =>
            i.number === issue.number ? { ...i, status: "in-progress" as const } : i,
          );
        }
        return [...prev, { number: issue.number, title: issue.title, status: "in-progress" as const }];
      });
      addParallelActivity(`#${issue.number} ${issue.title}`, "active", model ?? "starting");
    });

    bus.onTyped("issue:progress", ({ issueNumber, step }) => {
      updateActivity(issueNumber, step);
    });

    bus.onTyped("issue:done", ({ issueNumber, duration_ms }) => {
      setIssues((prev) =>
        prev.map((i) =>
          i.number === issueNumber ? { ...i, status: "done" as const } : i,
        ),
      );
      if (currentIssue === issueNumber) {
        setCurrentIssue(null);
      }
      const secs = Math.round(duration_ms / 1000);
      // Mark the issue's active entry as done
      setActivities((prev) =>
        prev.map((a) =>
          a.label.startsWith(`#${issueNumber} `) && a.status === "active"
            ? { ...a, status: "done" as const, detail: `completed ${formatDuration(secs)}` }
            : a,
        ),
      );
    });

    bus.onTyped("issue:fail", ({ issueNumber, reason }) => {
      setIssues((prev) =>
        prev.map((i) =>
          i.number === issueNumber ? { ...i, status: "failed" as const } : i,
        ),
      );
      if (currentIssue === issueNumber) {
        setCurrentIssue(null);
      }
      // Mark the issue's active entry as failed
      setActivities((prev) => {
        const hasEntry = prev.some((a) => a.label.startsWith(`#${issueNumber} `) && a.status === "active");
        if (hasEntry) {
          return prev.map((a) =>
            a.label.startsWith(`#${issueNumber} `) && a.status === "active"
              ? { ...a, status: "done" as const, detail: `failed: ${reason}` }
              : a,
          );
        }
        return [...prev, { label: `#${issueNumber} failed`, status: "done" as const, detail: reason }];
      });
    });

    bus.onTyped("sprint:paused", () => {
      setIsPaused(true);
    });

    bus.onTyped("sprint:resumed", ({ phase: resumedPhase }) => {
      setIsPaused(false);
      setPhase(resumedPhase);
    });

    bus.onTyped("log", ({ level, message }) => {
      const time = new Date().toLocaleTimeString();
      setLogEntries((prev) => [...prev, { time, level, message }]);
    });

    bus.onTyped("sprint:error", ({ error }) => {
      const time = new Date().toLocaleTimeString();
      setLogEntries((prev) => [...prev, { time, level: "error" as const, message: error }]);
    });

    bus.onTyped("sprint:start", ({ sprintNumber: n, resumed }) => {
      setSprintNumber(n);
      setStartedAt(new Date());
      const time = new Date().toLocaleTimeString();
      const msg = resumed ? `Resuming Sprint ${n}` : `Starting Sprint ${n}`;
      setLogEntries((prev) => [...prev, { time, level: "info" as const, message: msg }]);
    });

    bus.onTyped("sprint:complete", ({ sprintNumber: n }) => {
      const time = new Date().toLocaleTimeString();
      setLogEntries((prev) => [...prev, { time, level: "info" as const, message: `Sprint ${n} complete!` }]);
      setSprintNumber(n);
    });
  }, [runner]);

  const [isRunning, setIsRunning] = React.useState(false);

  useInput((input) => {
    switch (input) {
      case "g":
        if (!isRunning && onStart) {
          setIsRunning(true);
          onStart();
        }
        break;
      case "p":
        runner.pause();
        break;
      case "r":
        runner.resume();
        break;
      case "q":
        exit();
        process.exit(0);
        break;
    }
  });

  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const logHeight = Math.max(6, Math.floor(termHeight * 0.25));
  const mainHeight = Math.max(4, termHeight - 3 - logHeight - 1);

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header
        sprintNumber={sprintNumber}
        phase={phase}
        completedCount={completedCount}
        totalCount={issues.length}
        startedAt={startedAt}
      />
      <Box height={mainHeight}>
        <IssueList issues={issues} />
        <ActivityPanel
          phase={phase}
          currentIssue={currentIssue}
          activities={activities.slice(-15)}
        />
      </Box>
      <LogPanel entries={logEntries} maxEntries={logHeight - 2} />
      <CommandBar isPaused={isPaused} isRunning={isRunning} />
    </Box>
  );
}

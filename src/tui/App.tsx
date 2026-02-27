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

  const [phase, setPhase] = React.useState<SprintPhase>(initialState.phase);
  const [sprintNumber, setSprintNumber] = React.useState(initialState.sprintNumber);
  const [startedAt, setStartedAt] = React.useState(initialState.startedAt);
  const [issues, setIssues] = React.useState<IssueEntry[]>(initialIssues ?? []);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [currentIssue, setCurrentIssue] = React.useState<number | null>(null);
  const [logEntries, setLogEntries] = React.useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = React.useState(false);

  const completedCount = issues.filter((i) => i.status === "done").length;

  // Build activity list from phase transitions and events
  const addActivity = (label: string, status: ActivityItem["status"], detail?: string) => {
    setActivities((prev) => {
      // Mark previous active items as done
      const updated = prev.map((a) =>
        a.status === "active" ? { ...a, status: "done" as const } : a,
      );
      return [...updated, { label, status, detail }];
    });
  };

  React.useEffect(() => {
    const bus = runner.events;

    bus.onTyped("phase:change", ({ from, to }) => {
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
        addActivity(labels[to] ?? to, status);
      }
    });

    bus.onTyped("issue:start", ({ issue }) => {
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
      addActivity(`#${issue.number} ${issue.title}`, "active", "executing");
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
      addActivity(`#${issueNumber} done`, "done", `${secs}s`);
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
      addActivity(`#${issueNumber} failed`, "done", reason);
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

    bus.onTyped("sprint:start", ({ sprintNumber: n }) => {
      setSprintNumber(n);
      setStartedAt(new Date());
      const time = new Date().toLocaleTimeString();
      setLogEntries((prev) => [...prev, { time, level: "info" as const, message: `Starting Sprint ${n}` }]);
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

import React from "react";
import { Box, useInput, useApp, useStdout } from "ink";
import type { SprintRunner } from "../runner.js";
import type { SprintPhase } from "../runner.js";
import { Header } from "./Header.js";
import { IssueList } from "./IssueList.js";
import type { IssueEntry } from "./IssueList.js";
import { WorkerPanel } from "./WorkerPanel.js";
import { LogPanel } from "./LogPanel.js";
import type { LogEntry } from "./LogPanel.js";
import { CommandBar } from "./CommandBar.js";

const MAX_WORKER_LINES = 20;

export interface AppProps {
  runner: SprintRunner;
  onStart?: () => void;
}

export function App({ runner, onStart }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const initialState = runner.getState();

  const [phase, setPhase] = React.useState<SprintPhase>(initialState.phase);
  const [sprintNumber, setSprintNumber] = React.useState(initialState.sprintNumber);
  const [startedAt, setStartedAt] = React.useState(initialState.startedAt);
  const [issues, setIssues] = React.useState<IssueEntry[]>([]);
  const [workerLines, setWorkerLines] = React.useState<string[]>([]);
  const [currentIssue, setCurrentIssue] = React.useState<number | null>(null);
  const [logEntries, setLogEntries] = React.useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = React.useState(false);

  const completedCount = issues.filter((i) => i.status === "done").length;

  React.useEffect(() => {
    const bus = runner.events;

    bus.onTyped("phase:change", ({ from, to }) => {
      setPhase(to);
      // Reset state when a new sprint starts (init phase from any terminal state)
      if (to === "init" && (from === "complete" || from === "failed")) {
        setIssues([]);
        setWorkerLines([]);
        setCurrentIssue(null);
        setStartedAt(new Date());
      }
    });

    bus.onTyped("issue:start", ({ issue }) => {
      setCurrentIssue(issue.number);
      setWorkerLines([]);
      setIssues((prev) => {
        const exists = prev.some((i) => i.number === issue.number);
        if (exists) {
          return prev.map((i) =>
            i.number === issue.number ? { ...i, status: "in-progress" as const } : i,
          );
        }
        return [...prev, { number: issue.number, title: issue.title, status: "in-progress" as const }];
      });
    });

    bus.onTyped("issue:done", ({ issueNumber }) => {
      setIssues((prev) =>
        prev.map((i) =>
          i.number === issueNumber ? { ...i, status: "done" as const } : i,
        ),
      );
      if (currentIssue === issueNumber) {
        setCurrentIssue(null);
      }
    });

    bus.onTyped("issue:fail", ({ issueNumber }) => {
      setIssues((prev) =>
        prev.map((i) =>
          i.number === issueNumber ? { ...i, status: "failed" as const } : i,
        ),
      );
      if (currentIssue === issueNumber) {
        setCurrentIssue(null);
      }
    });

    bus.onTyped("worker:output", ({ text }) => {
      setWorkerLines((prev) => [...prev, text].slice(-MAX_WORKER_LINES));
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
  // Reserve: Header (3 lines) + CommandBar (1 line) + LogPanel (~8 lines)
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
        <WorkerPanel
          lines={workerLines}
          currentIssue={currentIssue}
          model={null}
          duration={null}
        />
      </Box>
      <LogPanel entries={logEntries} maxEntries={logHeight - 2} />
      <CommandBar isPaused={isPaused} isRunning={isRunning} />
    </Box>
  );
}

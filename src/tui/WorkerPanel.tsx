import React from "react";
import { Box, Text } from "ink";
import type { SprintPhase } from "../runner.js";

export interface ActivityItem {
  label: string;
  status: "active" | "done" | "waiting";
  detail?: string;
  startedAt?: number;
}

export interface ActivityPanelProps {
  phase: SprintPhase;
  currentIssue: number | null;
  activities: ActivityItem[];
}

function phaseLabel(phase: SprintPhase): string {
  switch (phase) {
    case "init": return "Initializing…";
    case "refine": return "Refining backlog…";
    case "plan": return "Planning sprint…";
    case "execute": return "Executing issues…";
    case "review": return "Running sprint review…";
    case "retro": return "Running retrospective…";
    case "complete": return "Sprint complete ✓";
    case "paused": return "Paused";
    case "failed": return "Sprint failed ✗";
  }
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m${rem.toString().padStart(2, "0")}s`;
}

function statusIcon(status: ActivityItem["status"]): React.ReactElement {
  switch (status) {
    case "active":
      return <Text color="yellow">▸ </Text>;
    case "done":
      return <Text color="green">✓ </Text>;
    case "waiting":
      return <Text dimColor>○ </Text>;
  }
}

function ElapsedTimer({ startedAt }: { startedAt: number }): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(Date.now() - startedAt);
  React.useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return <Text color="cyan"> {formatElapsed(elapsed)}</Text>;
}

export function ActivityPanel({ phase, currentIssue, activities }: ActivityPanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={2}>
      <Box>
        <Text bold underline>Activity</Text>
        {currentIssue != null && <Text> │ #{currentIssue}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text bold>{phaseLabel(phase)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {activities.map((a, i) => (
          <Box key={i}>
            {statusIcon(a.status)}
            <Text dimColor={a.status === "waiting"}>{a.label}</Text>
            {a.detail && <Text dimColor> — {a.detail}</Text>}
            {a.status === "active" && a.startedAt && <ElapsedTimer startedAt={a.startedAt} />}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

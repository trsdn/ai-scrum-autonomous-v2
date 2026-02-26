import React from "react";
import { Box, Text } from "ink";
import type { SprintPhase } from "../runner.js";

export interface HeaderProps {
  sprintNumber: number;
  phase: SprintPhase;
  completedCount: number;
  totalCount: number;
  startedAt: Date;
}

function phaseColor(phase: SprintPhase): string {
  switch (phase) {
    case "complete":
      return "green";
    case "execute":
      return "yellow";
    case "plan":
    case "refine":
      return "blue";
    case "failed":
      return "red";
    case "paused":
      return "magenta";
    default:
      return "white";
  }
}

function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function Header({ sprintNumber, phase, completedCount, totalCount, startedAt }: HeaderProps): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>Sprint {sprintNumber}</Text>
      <Text> │ Phase: </Text>
      <Text color={phaseColor(phase)} bold>{phase}</Text>
      <Text> │ {completedCount}/{totalCount} done</Text>
      <Text> │ {formatElapsed(startedAt)}</Text>
    </Box>
  );
}

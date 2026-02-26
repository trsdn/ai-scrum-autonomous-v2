import React from "react";
import { Box, Text } from "ink";

export interface LogEntry {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface LogPanelProps {
  entries: LogEntry[];
}

const MAX_ENTRIES = 15;

function levelColor(level: LogEntry["level"]): string {
  switch (level) {
    case "warn":
      return "yellow";
    case "error":
      return "red";
    default:
      return "white";
  }
}

export function LogPanel({ entries }: LogPanelProps): React.ReactElement {
  const visible = entries.slice(-MAX_ENTRIES);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold underline>Log</Text>
      {visible.map((entry, i) => (
        <Box key={i}>
          <Text dimColor>{entry.time} </Text>
          <Text color={levelColor(entry.level)}>[{entry.level.toUpperCase()}] </Text>
          <Text color={levelColor(entry.level)}>{entry.message}</Text>
        </Box>
      ))}
    </Box>
  );
}

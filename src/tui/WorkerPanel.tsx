import React from "react";
import { Box, Text } from "ink";

export interface WorkerPanelProps {
  lines: string[];
  currentIssue: number | null;
  model: string | null;
  duration: string | null;
}

export function WorkerPanel({ lines, currentIssue, model, duration }: WorkerPanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={2}>
      <Box>
        <Text bold underline>Worker</Text>
        {currentIssue != null && <Text> │ #{currentIssue}</Text>}
        {model && <Text> │ {model}</Text>}
        {duration && <Text> │ {duration}</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

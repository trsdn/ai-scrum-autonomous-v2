import React from "react";
import { Box, Text } from "ink";

export interface CommandBarProps {
  isPaused: boolean;
  isRunning: boolean;
}

export function CommandBar({ isPaused, isRunning }: CommandBarProps): React.ReactElement {
  return (
    <Box paddingX={1} gap={2}>
      {!isRunning && (
        <Text bold color="green">[g]o</Text>
      )}
      {isRunning && (
        <>
          <Text dimColor={isPaused} bold={!isPaused} color={!isPaused ? "yellow" : undefined}>
            [p]ause
          </Text>
          <Text dimColor={!isPaused} bold={isPaused} color={isPaused ? "green" : undefined}>
            [r]esume
          </Text>
          <Text bold color="cyan">[s]kip</Text>
        </>
      )}
      <Text bold color="red">[q]uit</Text>
    </Box>
  );
}

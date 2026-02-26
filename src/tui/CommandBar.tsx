import React from "react";
import { Box, Text } from "ink";

export interface CommandBarProps {
  isPaused: boolean;
}

export function CommandBar({ isPaused }: CommandBarProps): React.ReactElement {
  return (
    <Box paddingX={1} gap={2}>
      <Text dimColor={isPaused} bold={!isPaused} color={!isPaused ? "yellow" : undefined}>
        [p]ause
      </Text>
      <Text dimColor={!isPaused} bold={isPaused} color={isPaused ? "green" : undefined}>
        [r]esume
      </Text>
      <Text bold color="cyan">[s]kip</Text>
      <Text bold color="red">[q]uit</Text>
    </Box>
  );
}

import React from "react";
import { Box, Text } from "ink";

export type IssueStatus = "in-progress" | "done" | "planned" | "failed";

export interface IssueEntry {
  number: number;
  title: string;
  status: IssueStatus;
}

export interface IssueListProps {
  issues: IssueEntry[];
}

function statusIcon(status: IssueStatus): React.ReactElement {
  switch (status) {
    case "in-progress":
      return <Text color="yellow">●</Text>;
    case "done":
      return <Text color="green">✓</Text>;
    case "planned":
      return <Text dimColor>○</Text>;
    case "failed":
      return <Text color="red">⊘</Text>;
  }
}

export function IssueList({ issues }: IssueListProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={1}>
      <Text bold underline>Issues</Text>
      {issues.map((issue) => (
        <Box key={issue.number}>
          {statusIcon(issue.status)}
          <Text> #{issue.number} </Text>
          <Text dimColor={issue.status === "planned"}>{issue.title}</Text>
        </Box>
      ))}
    </Box>
  );
}

export interface SprintIssue {
  number: number;
  title: string;
  ice_score: number;
  depends_on: number[];
  acceptanceCriteria: string;
  expectedFiles: string[];
  points: number;
}

export interface SprintPlan {
  sprintNumber: number;
  sprint_issues: SprintIssue[];
  execution_groups: number[][];
  estimated_points: number;
  rationale: string;
}

export interface RefinedIssue {
  number: number;
  title: string;
  ice_score: number;
}

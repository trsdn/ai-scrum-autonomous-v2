import type { QualityResult } from "./quality.js";

export interface CodeReviewResult {
  approved: boolean;
  feedback: string;
  issues: string[];
}

export interface IssueResult {
  issueNumber: number;
  status: "completed" | "failed" | "in-progress";
  qualityGatePassed: boolean;
  qualityDetails: QualityResult;
  codeReview?: CodeReviewResult;
  branch: string;
  duration_ms: number;
  filesChanged: string[];
  retryCount: number;
  points: number;
}

export interface SprintResult {
  results: IssueResult[];
  sprint: number;
  parallelizationRatio: number;
  avgWorktreeLifetime: number;
  mergeConflicts: number;
}

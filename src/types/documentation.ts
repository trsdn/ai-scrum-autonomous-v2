import type { QualityResult } from "./quality.js";
import type { CodeReviewResult } from "./execution.js";

export interface HuddleEntry {
  issueNumber: number;
  issueTitle: string;
  status: "completed" | "failed";
  qualityResult: QualityResult;
  codeReview?: CodeReviewResult;
  duration_ms: number;
  filesChanged: string[];
  timestamp: Date;
  cleanupWarning?: string;
  errorMessage?: string;
  prStats?: { prNumber: number; additions: number; deletions: number; changedFiles: number };
  retryCount: number;
}

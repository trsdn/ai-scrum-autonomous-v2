// Shared type definitions for the Sprint Runner

// --- Sprint Planning ---

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

// --- Issue Execution ---

export interface IssueResult {
  issueNumber: number;
  status: "completed" | "failed" | "in-progress";
  qualityGatePassed: boolean;
  qualityDetails: QualityResult;
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

// --- Quality Gates ---

export interface QualityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface QualityResult {
  passed: boolean;
  checks: QualityCheck[];
}

// --- Escalation ---

export type EscalationLevel = "must" | "should" | "info";

export interface EscalationEvent {
  level: EscalationLevel;
  reason: string;
  detail: string;
  context: Record<string, unknown>;
  timestamp: Date;
  issueNumber?: number;
}

// --- Sprint Metrics ---

export interface SprintMetrics {
  planned: number;
  completed: number;
  failed: number;
  pointsPlanned: number;
  pointsCompleted: number;
  velocity: number;
  avgDuration: number;
  firstPassRate: number;
  driftIncidents: number;
}

// --- Drift ---

export interface DriftReport {
  totalFilesChanged: number;
  plannedChanges: number;
  unplannedChanges: string[];
  driftPercentage: number;
}

export interface DriftIncident {
  issueNumber: number;
  files: string[];
}

// --- Git ---

export interface Worktree {
  path: string;
  branch: string;
  issueNumber: number;
}

export interface DiffStat {
  linesChanged: number;
  filesChanged: number;
  files: string[];
}

// --- Documentation ---

export interface HuddleEntry {
  issueNumber: number;
  issueTitle: string;
  status: "completed" | "failed";
  qualityResult: QualityResult;
  duration_ms: number;
  filesChanged: string[];
  timestamp: Date;
}

// --- Ceremonies ---

export interface RefinedIssue {
  number: number;
  title: string;
  ice_score: number;
}

export interface ReviewResult {
  summary: string;
  demoItems: string[];
  velocityUpdate: string;
  openItems: string[];
}

export interface RetroImprovement {
  title: string;
  description: string;
  autoApplicable: boolean;
  target: "config" | "agent" | "skill" | "process";
}

export interface RetroResult {
  wentWell: string[];
  wentBadly: string[];
  improvements: RetroImprovement[];
  previousImprovementsChecked: boolean;
}

// --- Configuration ---

export interface SprintConfig {
  sprintNumber: number;
  projectPath: string;
  baseBranch: string;
  worktreeBase: string;
  branchPattern: string;
  maxParallelSessions: number;
  maxIssuesPerSprint: number;
  maxDriftIncidents: number;
  maxRetries: number;
  enableChallenger: boolean;
  autoRevertDrift: boolean;
  autoMerge: boolean;
  squashMerge: boolean;
  deleteBranchAfterMerge: boolean;
  sessionTimeoutMs: number;
  customInstructions: string;
  githubMcp: McpServerConfig;
}

export interface McpServerConfig {
  command: string;
  args: string[];
}

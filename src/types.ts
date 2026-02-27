// Shared type definitions for the Sprint Runner

import { z } from "zod";

// --- Zod Response Schemas (for validating ACP responses) ---

export const SprintPlanSchema = z.object({
  sprintNumber: z.coerce.number(),
  sprint_issues: z
    .array(
      z.object({
        number: z.coerce.number(),
        title: z.string().default(""),
        ice_score: z.number().default(0),
        depends_on: z.array(z.coerce.number()).default([]),
        acceptanceCriteria: z.string().default(""),
        expectedFiles: z.array(z.string()).default([]),
        points: z.number().default(0),
      }),
    )
    .min(1),
  execution_groups: z.array(z.array(z.coerce.number())).optional(),
  estimated_points: z.number().default(0),
  rationale: z.string().default(""),
});

export const ReviewResultSchema = z.object({
  summary: z.string().default("No summary provided"),
  demoItems: z.array(z.string()).default([]),
  velocityUpdate: z.string().default(""),
  openItems: z.array(z.string()).default([]),
});

export const RetroResultSchema = z.object({
  wentWell: z.array(z.string()).default([]),
  wentBadly: z.array(z.string()).default([]),
  improvements: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        autoApplicable: z.boolean().default(false),
        target: z.enum(["config", "agent", "skill", "process"]).default("process"),
      }),
    )
    .default([]),
  previousImprovementsChecked: z.boolean().default(false),
});

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
  codeReview?: CodeReviewResult;
  duration_ms: number;
  filesChanged: string[];
  timestamp: Date;
  cleanupWarning?: string;
  errorMessage?: string;
  prStats?: { prNumber: number; additions: number; deletions: number; changedFiles: number };
  retryCount: number;
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

// --- MCP Server Configuration (matches ACP SDK McpServer types) ---

export interface McpServerStdio {
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface McpServerHttp {
  type: "http";
  name: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

export interface McpServerSse {
  type: "sse";
  name: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

export type McpServerEntry = McpServerStdio | McpServerHttp | McpServerSse;

// --- Phase Configuration ---

export interface PhaseConfig {
  model?: string;
  mcp_servers: McpServerEntry[];
  instructions: string[];
}

// --- Configuration ---

export interface SprintConfig {
  sprintNumber: number;
  sprintPrefix: string;
  sprintSlug: string;
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
  backlogLabels: string[];
  autoMerge: boolean;
  squashMerge: boolean;
  deleteBranchAfterMerge: boolean;
  sessionTimeoutMs: number;
  /** @deprecated Use globalInstructions or per-phase instructions instead. */
  customInstructions: string;
  autoApproveTools: boolean;
  allowToolPatterns: string[];
  globalMcpServers: McpServerEntry[];
  globalInstructions: string[];
  phases: Record<string, PhaseConfig>;
}

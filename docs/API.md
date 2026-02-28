# API Reference

Public exports for all modules. For architecture overview, see [OVERVIEW.md](OVERVIEW.md).

---

## Module Index

| Module | Purpose |
|--------|---------|
| [`runner`](#runner) | Sprint orchestration engine |
| [`config`](#config) | YAML configuration loading & validation |
| [`events`](#events) | Typed event bus (15 event types) |
| [`state-manager`](#state-manager) | Atomic state persistence with locking |
| [`metrics`](#metrics) | Sprint metrics calculation |
| [`acp/`](#acp) | ACP client, session config, permissions |
| [`ceremonies/`](#ceremonies) | Sprint ceremonies (refine, plan, execute, review, retro) |
| [`enforcement/`](#enforcement) | Quality gates, drift, escalation, code review |
| [`github/`](#github) | GitHub API (issues, labels, milestones) |
| [`git/`](#git) | Git operations (worktrees, merge, diff) |
| [`documentation/`](#documentation) | Sprint logs, velocity, huddles |
| [`dashboard/`](#dashboard) | Web dashboard (HTTP + WebSocket) |

---

## Runner

```typescript
class SprintRunner {
  constructor(config: SprintConfig, eventBus?: SprintEventBus)
  getClient(): AcpClient
  loadSavedState(): SprintState | null
  fullCycle(): Promise<SprintState>
  static sprintLoop(configBuilder, eventBus?): Promise<SprintState[]>
  runRefine(): Promise<RefinedIssue[]>
  runPlan(refinedIssues?): Promise<SprintPlan>
  runExecute(plan): Promise<SprintResult>
  runReview(result): Promise<ReviewResult>
  runRetro(result, review): Promise<RetroResult>
  pause(): void
  resume(): void
  getState(): SprintState
}
```

```typescript
type SprintPhase = "init" | "refine" | "plan" | "execute" | "review" | "retro" | "complete" | "paused" | "failed"

interface SprintState {
  version: string
  sprintNumber: number
  phase: SprintPhase
  plan?: SprintPlan
  result?: SprintResult
  review?: ReviewResult
  retro?: RetroResult
  startedAt: Date
  issuesCreatedCount?: number
  error?: string
}
```

---

## Config

```typescript
function loadConfig(configPath?: string): ConfigFile
function substituteEnvVars(text: string): string
function prefixToSlug(prefix: string): string
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for full config schema with defaults.

---

## Events

```typescript
class SprintEventBus extends EventEmitter {
  emitTyped<K>(event: K, payload: SprintEngineEvents[K]): void
  onTyped<K>(event: K, listener: (payload: SprintEngineEvents[K]) => void): this
}
```

### Event Types

| Event | Payload |
|-------|---------|
| `phase:change` | `{ from: SprintPhase, to: SprintPhase, model?, agent? }` |
| `issue:start` | `{ issue: SprintIssue, model? }` |
| `issue:progress` | `{ issueNumber: number, step: string }` |
| `issue:done` | `{ issueNumber: number, quality: QualityResult, duration_ms: number }` |
| `issue:fail` | `{ issueNumber: number, reason: string, duration_ms: number }` |
| `worker:output` | `{ sessionId: string, text: string }` |
| `session:start` | `{ sessionId: string, role: string, issueNumber?, model? }` |
| `session:end` | `{ sessionId: string }` |
| `sprint:start` | `{ sprintNumber: number, resumed? }` |
| `sprint:planned` | `{ issues: { number, title }[] }` |
| `sprint:complete` | `{ sprintNumber: number }` |
| `sprint:error` | `{ error: string }` |
| `sprint:paused` | `{}` |
| `sprint:resumed` | `{ phase: SprintPhase }` |
| `log` | `{ level: "info" \| "warn" \| "error", message: string }` |

---

## State Manager

```typescript
const STATE_VERSION = "1"

function getStatePath(config: SprintConfig): string
function saveState(state: SprintState, filePath: string): void    // Atomic: tmp→fsync→rename
function loadState(filePath: string): SprintState | null
function acquireLock(config: SprintConfig): void                  // PID-based exclusive lock
function releaseLock(config: SprintConfig): void
```

---

## Metrics

```typescript
function calculateSprintMetrics(result: SprintResult): SprintMetrics
function formatDuration(ms: number): string           // e.g., "2m 30s"
function percent(part: number, total: number): number  // 0–100 rounded
function topFailedGates(result: SprintResult): string  // Comma-separated failures
```

```typescript
interface SprintMetrics {
  planned: number
  completed: number
  failed: number
  pointsPlanned: number
  pointsCompleted: number
  velocity: number
  avgDuration: number        // ms
  firstPassRate: number      // 0–100
  driftIncidents: number
}
```

---

## ACP

```typescript
class AcpClient {
  connect(): Promise<void>
  createSession(options: CreateSessionOptions): Promise<SessionInfo>
  sendPrompt(sessionId, prompt, timeoutMs?): Promise<PromptResult>
  setMode(sessionId, mode): Promise<void>
  setModel(sessionId, model): Promise<void>
  endSession(sessionId): Promise<void>
  getSessionOutput(sessionId): string[]
  disconnect(): Promise<void>
}

function resolveSessionConfig(config: SprintConfig, phase: CeremonyPhase): Promise<ResolvedSessionConfig>
function loadInstructions(filePaths: string[], projectPath: string): Promise<string>
function createPermissionHandler(config?: PermissionConfig, log?): Function
```

```typescript
type CeremonyPhase = "planner" | "worker" | "reviewer" | "test-engineer" | "refinement" | "planning" | "review" | "retro" | "challenger" | "conflict-resolver"
```

---

## Ceremonies

```typescript
function runRefinement(client, config, eventBus?): Promise<RefinedIssue[]>
function runSprintPlanning(client, config, refinedIssues?, eventBus?): Promise<SprintPlan>
function runParallelExecution(client, config, plan, eventBus?): Promise<SprintResult>
function runSprintReview(client, config, result, eventBus?): Promise<ReviewResult>
function runSprintRetro(client, config, result, review, eventBus?, state?): Promise<RetroResult>
function executeIssue(client, config, issue, eventBus?): Promise<IssueResult>
function buildExecutionGroups(issues: SprintIssue[]): ExecutionGroup[]
function splitByFileOverlap(issueNumbers, issueMap): number[][]
function detectCircularDependencies(issues): number[][] | null
function substitutePrompt(template, vars): string
function sanitizePromptInput(input: string): string
function extractJson<T>(text): T
```

---

## Enforcement

```typescript
function runQualityGate(config, worktreePath, branch?, baseBranch?): Promise<QualityResult>
function verifyMainBranch(projectPath, config): Promise<QualityResult>
function runCodeReview(client, config, issue, branch, worktreePath, eventBus?): Promise<CodeReviewResult>
function runChallengerReview(client, config, branch, issueNumber): Promise<ChallengerResult>
function checkIssueDrift(changedFiles, expectedFiles): Promise<DriftCheckResult>
function holisticDriftCheck(allChanged, allExpected): Promise<DriftReport>
function escalateToStakeholder(event, config, eventBus?, state?): Promise<void>
```

---

## GitHub

```typescript
function listIssues(opts): Promise<GitHubIssue[]>
function getIssue(number): Promise<GitHubIssue>
function createIssue(options): Promise<GitHubIssue>
function createIssueRateLimited(options, state, max): Promise<GitHubIssue | null>
function addComment(issueNumber, body): Promise<void>
function setLabel(issueNumber, label): Promise<void>
function removeLabel(issueNumber, label): Promise<void>
function ensureLabelExists(name, color?, description?): Promise<void>
function getNextOpenMilestone(prefix?): Promise<{ milestone, sprintNumber } | undefined>
function createMilestone(title, description?): Promise<GitHubMilestone>
function closeMilestone(title): Promise<void>
function listSprintMilestones(prefix?): Promise<GitHubMilestone[]>
function execGh(args): Promise<string>    // Raw gh CLI execution with retry
```

---

## Git

```typescript
function createWorktree(options: CreateWorktreeOptions): Promise<void>
function removeWorktree(path): Promise<void>
function deleteBranch(branch, force?): Promise<void>
function mergeBranch(branch, baseBranch, options?): Promise<MergeResult>
function getPRStatus(branch): Promise<{ prNumber, state } | undefined>
function getPRStats(branch): Promise<PRStats | undefined>
function diffStat(branch, base): Promise<DiffStat>
function getChangedFiles(branch, base?): Promise<string[]>
```

---

## Documentation

```typescript
function createSprintLog(sprintNumber, goal, plannedCount, outputDir?, prefix?, slug?): string
function appendToSprintLog(sprintNumber, entry, outputDir?, slug?): void
function readSprintLog(sprintNumber, outputDir?, slug?): string
function readVelocity(filePath?): VelocityEntry[]
function appendVelocity(entry): void
function formatHuddleComment(entry: HuddleEntry): string
function formatSprintLogEntry(entry: HuddleEntry): string
```

---

## Dashboard

```typescript
class DashboardWebServer {
  start(port): Promise<void>
  shutdown(): Promise<void>
  broadcastEvent(message: ServerMessage): void
  broadcastState(state: SprintState): void
}

class SprintIssueCache {
  get(sprintNumber): CachedIssue[]
  has(sprintNumber): boolean
  initialize(): Promise<void>
  destroy(): void
}

class ChatManager {
  connect(): Promise<void>
  createChat(role): Promise<ChatSession>
  sendMessage(sessionId, message): Promise<string>
  close(sessionId): Promise<void>
  closeAll(): Promise<void>
}

class SessionController {
  enqueue(sessionId, message): void
  drain(sessionId): SessionMessage[]
  requestStop(sessionId): void
  shouldStop(sessionId): boolean
}

function loadSprintHistory(velocityPath?): SprintHistoryEntry[]
```

---

## Domain Types

```typescript
// Planning
interface SprintIssue { number, title, ice_score, depends_on[], acceptanceCriteria, expectedFiles[], points }
interface SprintPlan { sprintNumber, sprint_issues[], execution_groups[][], estimated_points, rationale }
interface RefinedIssue { number, title, ice_score }

// Execution
interface IssueResult { issueNumber, status, qualityGatePassed, qualityDetails, codeReview?, branch, duration_ms, filesChanged[], retryCount, points }
interface SprintResult { results[], sprint, parallelizationRatio, avgWorktreeLifetime, mergeConflicts }
interface CodeReviewResult { approved, feedback, issues[] }

// Quality
interface QualityCheck { name, passed, detail, category }
interface QualityResult { passed, checks: QualityCheck[] }

// Escalation
type EscalationLevel = "must" | "should" | "info"
interface EscalationEvent { level, reason, detail, context, timestamp, issueNumber? }

// Metrics
interface SprintMetrics { planned, completed, failed, pointsPlanned, pointsCompleted, velocity, avgDuration, firstPassRate, driftIncidents }

// Drift
interface DriftReport { totalFilesChanged, plannedChanges, unplannedChanges[], driftPercentage }

// Git
interface DiffStat { linesChanged, filesChanged, files[] }

// Ceremonies
interface ReviewResult { summary, demoItems[], velocityUpdate, openItems[] }
interface RetroResult { wentWell[], wentBadly[], improvements: RetroImprovement[], previousImprovementsChecked }
interface RetroImprovement { title, description, autoApplicable, target }
```

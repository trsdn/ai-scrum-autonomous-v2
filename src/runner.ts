import * as fs from "node:fs";
import * as path from "node:path";
import { AcpClient } from "./acp/client.js";
import { resolveSessionConfig } from "./acp/session-config.js";
import { runRefinement } from "./ceremonies/refinement.js";
import { runSprintPlanning } from "./ceremonies/planning.js";
import { runParallelExecution } from "./ceremonies/parallel-dispatcher.js";
import { runSprintReview } from "./ceremonies/review.js";
import { runSprintRetro } from "./ceremonies/retro.js";
import { createSprintLog } from "./documentation/sprint-log.js";
import { appendVelocity } from "./documentation/velocity.js";
import { calculateSprintMetrics } from "./metrics.js";
import { holisticDriftCheck } from "./enforcement/drift-control.js";
import { escalateToStakeholder } from "./enforcement/escalation.js";
import { closeMilestone, getNextOpenMilestone } from "./github/milestones.js";
import { logger as defaultLogger } from "./logger.js";
import { SprintEventBus } from "./tui/events.js";
import type {
  SprintConfig,
  SprintPlan,
  SprintResult,
  ReviewResult,
  RetroResult,
  RefinedIssue,
} from "./types.js";

export type SprintPhase =
  | "init"
  | "refine"
  | "plan"
  | "execute"
  | "review"
  | "retro"
  | "complete"
  | "paused"
  | "failed";

export interface SprintState {
  version: string;
  sprintNumber: number;
  phase: SprintPhase;
  plan?: SprintPlan;
  result?: SprintResult;
  review?: ReviewResult;
  retro?: RetroResult;
  startedAt: Date;
  error?: string;
}

const STATE_VERSION = "1";

// --- State persistence ---

export function saveState(state: SprintState, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...state, version: STATE_VERSION }, null, 2), "utf-8");
}

export function loadState(filePath: string): SprintState {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as SprintState;
  if (parsed.version && parsed.version !== STATE_VERSION) {
    throw new Error(
      `Incompatible sprint state version: got '${parsed.version}', expected '${STATE_VERSION}'. Delete the state file and restart.`,
    );
  }
  parsed.startedAt = new Date(parsed.startedAt);
  return parsed;
}

// --- Sprint Runner ---

export class SprintRunner {
  private state: SprintState;
  private client: AcpClient;
  private config: SprintConfig;
  private paused = false;
  private phaseBeforePause: SprintPhase | null = null;
  private readonly log;
  readonly events: SprintEventBus;

  constructor(config: SprintConfig, eventBus?: SprintEventBus) {
    this.config = config;
    this.events = eventBus ?? new SprintEventBus();
    this.client = new AcpClient({
      timeoutMs: config.sessionTimeoutMs,
      permissions: {
        autoApprove: config.autoApproveTools,
        allowPatterns: config.allowToolPatterns,
      },
      onStreamChunk: (sessionId, text) => {
        this.events.emitTyped("worker:output", { sessionId, text });
      },
    });
    this.state = {
      version: STATE_VERSION,
      sprintNumber: config.sprintNumber,
      phase: "init",
      startedAt: new Date(),
    };
    this.log = defaultLogger.child({
      component: "sprint-runner",
      sprint: config.sprintNumber,
    });
  }

  /** Get the ACP client (for direct use by dashboard). */
  getClient(): AcpClient {
    return this.client;
  }

  /** Run the full sprint cycle, resuming from a previous crash if state exists. */
  async fullCycle(): Promise<SprintState> {
    try {
      // Check for previous state to resume from
      const previous = this.tryLoadPreviousState();
      const resuming = previous && previous.phase !== "complete" && previous.plan;

      if (resuming && previous.plan) {
        this.state = { ...previous, error: undefined };
        this.log.info({ resumeFrom: previous.phase }, "Resuming sprint from previous state");
        this.events.emitTyped("sprint:start", { sprintNumber: this.config.sprintNumber, resumed: true });
        this.events.emitTyped("log", { level: "info", message: `Resuming Sprint ${this.config.sprintNumber} from ${previous.phase} phase` });
        await this.client.connect();

        // Determine where to resume based on previous phase
        const plan = previous.plan;
        let result = previous.result;
        let review = previous.review;

        // If we crashed during or after execute but before review
        if (!result || previous.phase === "execute") {
          // Filter out already-completed issues (they have status:done labels)
          await this.checkPaused();
          const workerModel = (await resolveSessionConfig(this.config, "worker")).model;
          this.transition("execute", workerModel, "Worker Agent");
          result = await this.runExecute(plan);
        }

        if (!review || previous.phase === "review") {
          await this.checkPaused();
          const reviewerModel = (await resolveSessionConfig(this.config, "reviewer")).model;
          this.transition("review", reviewerModel, "Review Agent");
          review = await this.runReview(result);
        }

        if (!previous.retro || previous.phase === "retro") {
          await this.checkPaused();
          this.transition("retro", undefined, "Retro Agent");
          const retro = await this.runRetro(result, review);
          this.state.retro = retro;
        }

        this.transition("complete");
        await this.client.disconnect();
        this.persistState();
        this.events.emitTyped("sprint:complete", { sprintNumber: this.config.sprintNumber });
        return this.state;
      }

      // --- Fresh sprint ---

      // 1. init
      this.transition("init");
      this.events.emitTyped("sprint:start", { sprintNumber: this.config.sprintNumber });
      createSprintLog(this.config.sprintNumber, "Sprint cycle started", 0);
      await this.client.connect();

      // 2. refine
      await this.checkPaused();
      this.transition("refine", undefined, "Refinement Agent");
      const refined = await this.runRefine();

      // 3. plan
      await this.checkPaused();
      const plannerModel = (await resolveSessionConfig(this.config, "planner")).model;
      this.transition("plan", plannerModel, "Planning Agent");
      const plan = await this.runPlan(refined);

      // 4. execute
      await this.checkPaused();
      const workerModel = (await resolveSessionConfig(this.config, "worker")).model;
      this.transition("execute", workerModel, "Worker Agent");
      const result = await this.runExecute(plan);

      // 5. review
      await this.checkPaused();
      const reviewerModel = (await resolveSessionConfig(this.config, "reviewer")).model;
      this.transition("review", reviewerModel, "Review Agent");
      const review = await this.runReview(result);

      // 6. retro
      await this.checkPaused();
      this.transition("retro", undefined, "Retro Agent");
      const retro = await this.runRetro(result, review);

      // 7. complete
      this.state.retro = retro;
      this.transition("complete");
      await this.client.disconnect();
      this.persistState();
      this.events.emitTyped("sprint:complete", { sprintNumber: this.config.sprintNumber });

      return this.state;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.phase = "failed";
      this.state.error = message;
      this.log.error({ error: message }, "Sprint cycle failed");
      this.events.emitTyped("sprint:error", { error: message });

      try {
        await this.client.disconnect();
      } catch {
        // best-effort disconnect
      }

      this.persistState();
      return this.state;
    }
  }

  /**
   * Run sprints in a continuous loop, auto-detecting the next sprint
   * from GitHub milestones. Closes each milestone on completion and
   * moves to the next open one. Stops when no open milestone is found.
   */
  static async sprintLoop(
    configBuilder: (sprintNumber: number) => SprintConfig,
    eventBus?: SprintEventBus,
  ): Promise<SprintState[]> {
    const log = defaultLogger.child({ component: "sprint-loop" });
    const results: SprintState[] = [];
    const bus = eventBus ?? new SprintEventBus();

    while (true) {
      let next;
      try {
        next = await getNextOpenMilestone();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, "Failed to detect next sprint milestone");
        bus.emitTyped("log", { level: "error", message: `Milestone detection failed: ${msg}` });
        break;
      }
      if (!next) {
        log.info("No open sprint milestones found — loop complete");
        bus.emitTyped("log", { level: "info", message: "No open sprint milestones — loop complete" });
        break;
      }

      const { sprintNumber, milestone } = next;
      log.info({ sprintNumber, milestone: milestone.title }, "Starting sprint");
      bus.emitTyped("log", { level: "info", message: `Starting ${milestone.title}` });

      const config = configBuilder(sprintNumber);
      const runner = new SprintRunner(config, bus);
      const state = await runner.fullCycle();
      results.push(state);

      if (state.phase === "complete") {
        try {
          await closeMilestone(milestone.title);
          log.info({ milestone: milestone.title }, "Milestone closed");
        } catch (err: unknown) {
          log.warn({ err, milestone: milestone.title }, "Failed to close milestone");
        }
      } else {
        log.warn({ phase: state.phase }, "Sprint did not complete — stopping loop");
        bus.emitTyped("log", { level: "warn", message: `Sprint ${sprintNumber} failed — loop stopped` });
        break;
      }
    }

    return results;
  }
  /** Run the refinement phase */
  async runRefine(): Promise<RefinedIssue[]> {
    this.log.info("Running refinement");
    const refined = await runRefinement(this.client, this.config);
    this.log.info({ count: refined.length }, "Refinement complete");
    return refined;
  }

  /** Run the sprint planning phase */
  async runPlan(refinedIssues?: RefinedIssue[]): Promise<SprintPlan> {
    this.log.info("Running sprint planning");
    const plan = await runSprintPlanning(this.client, this.config, refinedIssues);
    this.state.plan = plan;
    this.persistState();
    this.log.info(
      { issues: plan.sprint_issues.length, points: plan.estimated_points },
      "Sprint planning complete",
    );
    return plan;
  }

  /** Run the execution phase */
  async runExecute(plan: SprintPlan): Promise<SprintResult> {
    this.log.info("Running parallel execution");

    const workerModel = (await resolveSessionConfig(this.config, "worker")).model;

    // Emit issue:start for all planned issues
    for (const issue of plan.sprint_issues) {
      this.events.emitTyped("issue:start", { issue, model: workerModel });
    }

    const result = await runParallelExecution(this.client, this.config, plan, this.events);
    this.state.result = result;

    // Emit issue:done / issue:fail for each result
    for (const r of result.results) {
      if (r.status === "completed") {
        this.events.emitTyped("issue:done", {
          issueNumber: r.issueNumber,
          quality: r.qualityDetails,
          duration_ms: r.duration_ms,
        });
      } else {
        this.events.emitTyped("issue:fail", {
          issueNumber: r.issueNumber,
          reason: r.qualityDetails.checks.filter(c => !c.passed).map(c => c.name).join(", ") || "execution failed",
          duration_ms: r.duration_ms,
        });
      }
    }

    // Holistic drift check
    const allChanged = result.results.flatMap((r) => r.filesChanged);
    const allExpected = plan.sprint_issues.flatMap((i) => i.expectedFiles);
    const driftReport = await holisticDriftCheck(allChanged, allExpected);

    if (driftReport.driftPercentage > 0) {
      this.log.warn(
        { driftPercentage: driftReport.driftPercentage },
        "Drift detected during execution",
      );
    }

    if (driftReport.unplannedChanges.length > this.config.maxDriftIncidents) {
      await escalateToStakeholder(
        {
          level: "must",
          reason: "Excessive drift detected",
          detail: `${driftReport.unplannedChanges.length} unplanned file changes exceed threshold of ${this.config.maxDriftIncidents}`,
          context: { driftReport },
          timestamp: new Date(),
        },
        { ntfyEnabled: false },
      );
    }

    this.persistState();
    this.log.info(
      {
        completed: result.results.filter((r) => r.status === "completed").length,
        failed: result.results.filter((r) => r.status === "failed").length,
      },
      "Execution complete",
    );
    return result;
  }

  /** Run the sprint review phase */
  async runReview(result: SprintResult): Promise<ReviewResult> {
    this.log.info("Running sprint review");
    const metrics = calculateSprintMetrics(result);
    const review = await runSprintReview(this.client, this.config, result);
    this.state.review = review;

    // Append velocity
    appendVelocity({
      sprint: this.config.sprintNumber,
      date: new Date().toISOString().slice(0, 10),
      goal: this.state.plan?.rationale ?? "",
      planned: metrics.planned,
      done: metrics.completed,
      carry: metrics.failed,
      hours: Math.round(metrics.avgDuration * metrics.planned / 3_600_000),
      issuesPerHr:
        metrics.avgDuration > 0
          ? Math.round((metrics.completed / (metrics.avgDuration * metrics.planned / 3_600_000)) * 100) / 100
          : 0,
      notes: review.summary,
    });

    this.persistState();
    this.log.info("Sprint review complete");
    return review;
  }

  /** Run the retrospective phase */
  async runRetro(result: SprintResult, review: ReviewResult): Promise<RetroResult> {
    this.log.info("Running sprint retro");
    const retro = await runSprintRetro(this.client, this.config, result, review);
    this.state.retro = retro;
    this.persistState();
    this.log.info(
      { improvements: retro.improvements.length },
      "Sprint retro complete",
    );
    return retro;
  }

  /** Pause the sprint runner */
  pause(): void {
    if (this.state.phase !== "paused" && this.state.phase !== "failed" && this.state.phase !== "complete") {
      this.phaseBeforePause = this.state.phase;
      this.paused = true;
      this.state.phase = "paused";
      this.log.info({ previousPhase: this.phaseBeforePause }, "Sprint paused");
      this.events.emitTyped("sprint:paused", {});
      this.persistState();
    }
  }

  /** Resume the sprint runner */
  resume(): void {
    if (this.paused && this.phaseBeforePause) {
      this.paused = false;
      this.state.phase = this.phaseBeforePause;
      this.phaseBeforePause = null;
      this.log.info({ phase: this.state.phase }, "Sprint resumed");
      this.events.emitTyped("sprint:resumed", { phase: this.state.phase });
      this.persistState();
    }
  }

  /** Get current sprint state */
  getState(): SprintState {
    return { ...this.state };
  }

  // --- Private helpers ---

  private transition(phase: SprintPhase, model?: string, agent?: string): void {
    const previous = this.state.phase;
    this.state.phase = phase;
    this.log.info({ from: previous, to: phase, model, agent }, "Phase transition");
    this.events.emitTyped("phase:change", { from: previous, to: phase, model, agent });
  }

  private async checkPaused(): Promise<void> {
    while (this.paused) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private get stateFilePath(): string {
    return path.join(
      this.config.projectPath,
      "docs",
      "sprints",
      `sprint-${this.config.sprintNumber}-state.json`,
    );
  }

  private persistState(): void {
    try {
      saveState(this.state, this.stateFilePath);
    } catch (err: unknown) {
      this.log.warn({ err }, "Failed to persist sprint state");
    }
  }

  /** Try to load a previous state for this sprint. Returns null if none exists. */
  private tryLoadPreviousState(): SprintState | null {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        return loadState(this.stateFilePath);
      }
    } catch (err: unknown) {
      this.log.warn({ err }, "Failed to load previous state — starting fresh");
    }
    return null;
  }
}

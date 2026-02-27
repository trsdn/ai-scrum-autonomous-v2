import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SprintRunner, saveState, loadState } from "../src/runner.js";
import type { SprintState } from "../src/runner.js";
import type {
  SprintConfig,
  SprintPlan,
  SprintResult,
  ReviewResult,
  RetroResult,
  RefinedIssue,
} from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// --- Mocks ---

vi.mock("../src/acp/client.js", () => ({
  AcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/ceremonies/refinement.js", () => ({
  runRefinement: vi.fn().mockResolvedValue([
    { number: 1, title: "Issue 1", ice_score: 8 },
    { number: 2, title: "Issue 2", ice_score: 5 },
  ] satisfies RefinedIssue[]),
}));

vi.mock("../src/ceremonies/planning.js", () => ({
  runSprintPlanning: vi.fn().mockResolvedValue({
    sprintNumber: 1,
    sprint_issues: [
      {
        number: 1,
        title: "Issue 1",
        ice_score: 8,
        depends_on: [],
        acceptanceCriteria: "AC",
        expectedFiles: ["src/a.ts"],
        points: 3,
      },
    ],
    execution_groups: [[1]],
    estimated_points: 3,
    rationale: "Test sprint",
  } satisfies SprintPlan),
}));

vi.mock("../src/ceremonies/parallel-dispatcher.js", () => ({
  runParallelExecution: vi.fn().mockResolvedValue({
    results: [
      {
        issueNumber: 1,
        status: "completed",
        qualityGatePassed: true,
        qualityDetails: { passed: true, checks: [] },
        branch: "feat/1-test",
        duration_ms: 10000,
        filesChanged: ["src/a.ts"],
        retryCount: 0,
        points: 3,
      },
    ],
    sprint: 1,
    parallelizationRatio: 1,
    avgWorktreeLifetime: 10000,
    mergeConflicts: 0,
  } satisfies SprintResult),
}));

vi.mock("../src/ceremonies/review.js", () => ({
  runSprintReview: vi.fn().mockResolvedValue({
    summary: "Good sprint",
    demoItems: ["Feature A"],
    velocityUpdate: "3 points",
    openItems: [],
  } satisfies ReviewResult),
}));

vi.mock("../src/ceremonies/retro.js", () => ({
  runSprintRetro: vi.fn().mockResolvedValue({
    wentWell: ["Good collaboration"],
    wentBadly: ["Slow CI"],
    improvements: [],
    previousImprovementsChecked: true,
  } satisfies RetroResult),
}));

vi.mock("../src/documentation/sprint-log.js", () => ({
  createSprintLog: vi.fn().mockReturnValue("docs/sprints/sprint-1-log.md"),
}));

vi.mock("../src/documentation/velocity.js", () => ({
  appendVelocity: vi.fn(),
}));

vi.mock("../src/metrics.js", () => ({
  calculateSprintMetrics: vi.fn().mockReturnValue({
    planned: 1,
    completed: 1,
    failed: 0,
    pointsPlanned: 3,
    pointsCompleted: 3,
    velocity: 3,
    avgDuration: 10000,
    firstPassRate: 100,
    driftIncidents: 0,
  }),
}));

vi.mock("../src/enforcement/drift-control.js", () => ({
  holisticDriftCheck: vi.fn().mockResolvedValue({
    totalFilesChanged: 1,
    plannedChanges: 1,
    unplannedChanges: [],
    driftPercentage: 0,
  }),
}));

vi.mock("../src/enforcement/escalation.js", () => ({
  escalateToStakeholder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/logger.js", () => {
  const noop = vi.fn();
  const childLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      child: vi.fn().mockReturnValue(childLogger),
    },
    createLogger: vi.fn().mockReturnValue(childLogger),
  };
});

// --- Helpers ---

function makeConfig(overrides: Partial<SprintConfig> = {}): SprintConfig {
  return {
    sprintNumber: 1,
    sprintPrefix: "Sprint",
    sprintSlug: "sprint",
    projectPath: os.tmpdir(),
    baseBranch: "main",
    worktreeBase: "../sprint-worktrees",
    branchPattern: "{prefix}/{sprint}/issue-{issue}",
    maxParallelSessions: 4,
    maxIssuesPerSprint: 8,
    maxDriftIncidents: 2,
    maxRetries: 2,
    enableChallenger: false,
    autoRevertDrift: false,
  backlogLabels: [],
    autoMerge: true,
    squashMerge: true,
    deleteBranchAfterMerge: true,
    sessionTimeoutMs: 600000,
    customInstructions: "",
    globalMcpServers: [],
    globalInstructions: [],
    phases: {},
    ...overrides,
  };
}

// --- Tests ---

describe("saveState / loadState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips state to JSON file", () => {
    const state: SprintState = {
      sprintNumber: 1,
      phase: "plan",
      startedAt: new Date("2025-01-01T00:00:00Z"),
    };
    const filePath = path.join(tmpDir, "state.json");
    saveState(state, filePath);

    const loaded = loadState(filePath);
    expect(loaded.sprintNumber).toBe(1);
    expect(loaded.phase).toBe("plan");
    expect(loaded.startedAt).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("creates parent directories if needed", () => {
    const state: SprintState = {
      sprintNumber: 2,
      phase: "init",
      startedAt: new Date(),
    };
    const filePath = path.join(tmpDir, "a", "b", "state.json");
    saveState(state, filePath);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("writes atomically via temp file", () => {
    const state: SprintState = {
      sprintNumber: 1,
      phase: "plan",
      startedAt: new Date(),
    };
    const filePath = path.join(tmpDir, "atomic.json");
    const tmpPath = filePath + ".tmp";

    saveState(state, filePath);

    // Final file exists, .tmp does not linger
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);

    // Content is valid JSON with version
    const loaded = loadState(filePath);
    expect(loaded.phase).toBe("plan");
    expect(loaded.sprintNumber).toBe(1);
  });

  it("preserves optional fields", () => {
    const state: SprintState = {
      sprintNumber: 1,
      phase: "failed",
      startedAt: new Date(),
      error: "Something went wrong",
    };
    const filePath = path.join(tmpDir, "state.json");
    saveState(state, filePath);

    const loaded = loadState(filePath);
    expect(loaded.error).toBe("Something went wrong");
    expect(loaded.phase).toBe("failed");
  });
});

describe("SprintRunner", () => {
  let config: SprintConfig;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-"));
    config = makeConfig({ projectPath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("initializes with init phase", () => {
      const runner = new SprintRunner(config);
      const state = runner.getState();
      expect(state.phase).toBe("init");
      expect(state.sprintNumber).toBe(1);
      expect(state.startedAt).toBeInstanceOf(Date);
    });
  });

  describe("fullCycle", () => {
    it("runs all phases and returns completed state", async () => {
      const runner = new SprintRunner(config);
      const finalState = await runner.fullCycle();

      expect(finalState.phase).toBe("complete");
      expect(finalState.plan).toBeDefined();
      expect(finalState.result).toBeDefined();
      expect(finalState.review).toBeDefined();
      expect(finalState.retro).toBeDefined();
      expect(finalState.error).toBeUndefined();
    });

    it("creates state file on completion", async () => {
      const runner = new SprintRunner(config);
      await runner.fullCycle();

      const stateFile = path.join(tmpDir, "docs", "sprints", "sprint-1-state.json");
      expect(fs.existsSync(stateFile)).toBe(true);
    });

    it("sets failed phase on error", async () => {
      const { runRefinement } = await import("../src/ceremonies/refinement.js");
      vi.mocked(runRefinement).mockRejectedValueOnce(new Error("ACP timeout"));

      const runner = new SprintRunner(config);
      const finalState = await runner.fullCycle();

      expect(finalState.phase).toBe("failed");
      expect(finalState.error).toBe("ACP timeout");
    });

    it("disconnects client even on error", async () => {
      const { AcpClient } = await import("../src/acp/client.js");
      const mockDisconnect = vi.fn().mockResolvedValue(undefined);
      vi.mocked(AcpClient).mockImplementation(
        () =>
          ({
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: mockDisconnect,
          }) as any,
      );

      const { runRefinement } = await import("../src/ceremonies/refinement.js");
      vi.mocked(runRefinement).mockRejectedValueOnce(new Error("fail"));

      const runner = new SprintRunner(config);
      await runner.fullCycle();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("individual phase methods", () => {
    it("runRefine returns refined issues", async () => {
      const runner = new SprintRunner(config);
      // Connect first since phases need the client
      await (runner as any).client.connect();

      const refined = await runner.runRefine();
      expect(refined).toHaveLength(2);
      expect(refined[0]!.number).toBe(1);
      expect(refined[1]!.ice_score).toBe(5);
    });

    it("runPlan stores plan in state", async () => {
      const runner = new SprintRunner(config);
      await (runner as any).client.connect();

      const plan = await runner.runPlan();
      expect(plan.sprintNumber).toBe(1);
      expect(plan.sprint_issues).toHaveLength(1);

      const state = runner.getState();
      expect(state.plan).toEqual(plan);
    });

    it("runExecute stores result in state", async () => {
      const runner = new SprintRunner(config);
      await (runner as any).client.connect();

      const plan = await runner.runPlan();
      const result = await runner.runExecute(plan);
      expect(result.results).toHaveLength(1);

      const state = runner.getState();
      expect(state.result).toEqual(result);
    });

    it("runReview stores review in state", async () => {
      const runner = new SprintRunner(config);
      await (runner as any).client.connect();

      const plan = await runner.runPlan();
      const result = await runner.runExecute(plan);
      const review = await runner.runReview(result);
      expect(review.summary).toBe("Good sprint");

      const state = runner.getState();
      expect(state.review).toEqual(review);
    });

    it("runRetro stores retro in state", async () => {
      const runner = new SprintRunner(config);
      await (runner as any).client.connect();

      const plan = await runner.runPlan();
      const result = await runner.runExecute(plan);
      const review = await runner.runReview(result);
      const retro = await runner.runRetro(result, review);
      expect(retro.wentWell).toContain("Good collaboration");

      const state = runner.getState();
      expect(state.retro).toEqual(retro);
    });
  });

  describe("state transitions", () => {
    it("ends in complete phase after fullCycle", async () => {
      const runner = new SprintRunner(config);
      const finalState = await runner.fullCycle();

      expect(finalState.phase).toBe("complete");
      expect(finalState.plan).toBeDefined();
      expect(finalState.result).toBeDefined();
      expect(finalState.review).toBeDefined();
      expect(finalState.retro).toBeDefined();
    });

    it("state file records final phase", async () => {
      const runner = new SprintRunner(config);
      await runner.fullCycle();

      const stateFile = path.join(tmpDir, "docs", "sprints", "sprint-1-state.json");
      const persisted = loadState(stateFile);
      expect(persisted.phase).toBe("complete");
    });
  });

  describe("pause / resume", () => {
    it("sets phase to paused", () => {
      const runner = new SprintRunner(config);
      // Simulate being in a running phase
      (runner as any).state.phase = "execute";
      runner.pause();

      expect(runner.getState().phase).toBe("paused");
    });

    it("resumes to previous phase", () => {
      const runner = new SprintRunner(config);
      (runner as any).state.phase = "execute";
      runner.pause();
      expect(runner.getState().phase).toBe("paused");

      runner.resume();
      expect(runner.getState().phase).toBe("execute");
    });

    it("does not pause if already complete", () => {
      const runner = new SprintRunner(config);
      (runner as any).state.phase = "complete";
      runner.pause();
      expect(runner.getState().phase).toBe("complete");
    });

    it("does not pause if already failed", () => {
      const runner = new SprintRunner(config);
      (runner as any).state.phase = "failed";
      runner.pause();
      expect(runner.getState().phase).toBe("failed");
    });

    it("resume is no-op if not paused", () => {
      const runner = new SprintRunner(config);
      (runner as any).state.phase = "execute";
      runner.resume();
      expect(runner.getState().phase).toBe("execute");
    });

    it("checkPaused blocks until resumed", async () => {
      const runner = new SprintRunner(config);
      (runner as any).state.phase = "execute";
      runner.pause();

      let resolved = false;
      const promise = (runner as any).checkPaused().then(() => {
        resolved = true;
      });

      // Should still be paused after a short wait
      await new Promise((r) => setTimeout(r, 100));
      expect(resolved).toBe(false);

      runner.resume();
      await promise;
      expect(resolved).toBe(true);
    });
  });

  describe("getState", () => {
    it("returns a copy of the state", () => {
      const runner = new SprintRunner(config);
      const state1 = runner.getState();
      const state2 = runner.getState();
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });
  });

  describe("error handling", () => {
    it("handles non-Error throws", async () => {
      const { runRefinement } = await import("../src/ceremonies/refinement.js");
      vi.mocked(runRefinement).mockRejectedValueOnce("string error");

      const runner = new SprintRunner(config);
      const finalState = await runner.fullCycle();

      expect(finalState.phase).toBe("failed");
      expect(finalState.error).toBe("string error");
    });

    it("persists state on failure", async () => {
      const { runRefinement } = await import("../src/ceremonies/refinement.js");
      vi.mocked(runRefinement).mockRejectedValueOnce(new Error("boom"));

      const runner = new SprintRunner(config);
      await runner.fullCycle();

      const stateFile = path.join(tmpDir, "docs", "sprints", "sprint-1-state.json");
      expect(fs.existsSync(stateFile)).toBe(true);
      const persisted = loadState(stateFile);
      expect(persisted.phase).toBe("failed");
      expect(persisted.error).toBe("boom");
    });

    it("handles disconnect failure gracefully", async () => {
      const { AcpClient } = await import("../src/acp/client.js");
      vi.mocked(AcpClient).mockImplementation(
        () =>
          ({
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockRejectedValue(new Error("disconnect fail")),
          }) as any,
      );

      const { runRefinement } = await import("../src/ceremonies/refinement.js");
      vi.mocked(runRefinement).mockRejectedValueOnce(new Error("boom"));

      const runner = new SprintRunner(config);
      const finalState = await runner.fullCycle();

      // Should still report the original error, not the disconnect error
      expect(finalState.phase).toBe("failed");
      expect(finalState.error).toBe("boom");
    });
  });

  describe("drift escalation", () => {
    it("escalates when drift exceeds threshold", async () => {
      const { holisticDriftCheck } = await import(
        "../src/enforcement/drift-control.js"
      );
      vi.mocked(holisticDriftCheck).mockResolvedValueOnce({
        totalFilesChanged: 5,
        plannedChanges: 1,
        unplannedChanges: ["a.ts", "b.ts", "c.ts"],
        driftPercentage: 80,
      });

      const { escalateToStakeholder } = await import(
        "../src/enforcement/escalation.js"
      );

      const runner = new SprintRunner(config);
      const plan: SprintPlan = {
        sprintNumber: 1,
        sprint_issues: [
          {
            number: 1,
            title: "t",
            ice_score: 5,
            depends_on: [],
            acceptanceCriteria: "",
            expectedFiles: ["src/a.ts"],
            points: 3,
          },
        ],
        execution_groups: [[1]],
        estimated_points: 3,
        rationale: "test",
      };

      await (runner as any).client.connect();
      await runner.runExecute(plan);

      expect(escalateToStakeholder).toHaveBeenCalledWith(
        expect.objectContaining({ level: "must", reason: "Excessive drift detected" }),
        expect.any(Object),
      );
    });
  });
});

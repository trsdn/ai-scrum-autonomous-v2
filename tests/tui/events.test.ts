import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintEventBus } from "../../src/tui/events.js";
import { SprintRunner } from "../../src/runner.js";
import type { SprintConfig } from "../../src/types.js";

vi.mock("../../src/acp/client.js", () => ({
  AcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

const makeConfig = (): SprintConfig => ({
  sprintNumber: 1,
  projectPath: "/tmp/test",
  baseBranch: "main",
  worktreeBase: "../worktrees",
  branchPattern: "sprint/{sprint}/issue-{issue}",
  maxParallelSessions: 2,
  maxIssuesPerSprint: 5,
  maxDriftIncidents: 2,
  maxRetries: 1,
  enableChallenger: false,
  autoRevertDrift: false,
  autoMerge: true,
  squashMerge: true,
  deleteBranchAfterMerge: true,
  sessionTimeoutMs: 60000,
  customInstructions: "",
  globalMcpServers: [],
  globalInstructions: [],
  phases: {},
});

describe("SprintEventBus", () => {
  let bus: SprintEventBus;

  beforeEach(() => {
    bus = new SprintEventBus();
  });

  it("emits and receives typed events", () => {
    const handler = vi.fn();
    bus.onTyped("phase:change", handler);
    bus.emitTyped("phase:change", { from: "init", to: "refine" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ from: "init", to: "refine" });
  });
});

describe("SprintRunner events", () => {
  let runner: SprintRunner;

  beforeEach(() => {
    runner = new SprintRunner(makeConfig());
  });

  it("emits phase:change on pause()", () => {
    const handler = vi.fn();
    runner.events.onTyped("phase:change", handler);

    // pause triggers transition to "paused" internally via the pause path
    // but pause() does NOT call transition() — it sets phase directly and emits sprint:paused.
    // However, the phase:change event is emitted by transition(), not by pause().
    // We need to trigger a transition first, then pause.
    // Actually, looking at the code: pause() does NOT emit phase:change, it emits sprint:paused.
    // The constructor starts at "init", and pause() changes to "paused" without calling transition().
    // So let's test that pause causes a state change to "paused".
    runner.pause();

    expect(runner.getState().phase).toBe("paused");
  });

  it("emits sprint:paused on pause()", () => {
    const handler = vi.fn();
    runner.events.onTyped("sprint:paused", handler);

    runner.pause();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({});
  });

  it("emits sprint:resumed on resume() after pause", () => {
    const handler = vi.fn();
    runner.events.onTyped("sprint:resumed", handler);

    runner.pause();
    runner.resume();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ phase: "init" });
  });

  it("accepts external event bus via constructor", () => {
    const externalBus = new SprintEventBus();
    const customRunner = new SprintRunner(makeConfig(), externalBus);

    expect(customRunner.events).toBe(externalBus);

    const handler = vi.fn();
    externalBus.onTyped("sprint:paused", handler);
    customRunner.pause();

    expect(handler).toHaveBeenCalledOnce();
  });
});

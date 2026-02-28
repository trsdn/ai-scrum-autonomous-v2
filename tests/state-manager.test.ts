import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveState,
  loadState,
  getStatePath,
  acquireLock,
  releaseLock,
  STATE_VERSION,
} from "../src/state-manager.js";
import type { SprintConfig } from "../src/types.js";
import type { SprintState } from "../src/state-manager.js";

function makeConfig(projectPath: string): SprintConfig {
  return {
    sprintNumber: 3,
    sprintPrefix: "sprint",
    sprintSlug: "alpha",
    projectPath,
    baseBranch: "main",
    worktreeBase: "/tmp/wt",
    branchPattern: "feat/{issue}-{slug}",
    maxParallelSessions: 1,
    maxIssuesPerSprint: 5,
    maxDriftIncidents: 2,
    maxRetries: 3,
    enableChallenger: false,
    autoRevertDrift: false,
    backlogLabels: [],
    autoMerge: false,
    squashMerge: true,
    deleteBranchAfterMerge: true,
    sessionTimeoutMs: 60_000,
    customInstructions: "",
    autoApproveTools: false,
    allowToolPatterns: [],
    globalMcpServers: [],
    globalInstructions: [],
    phases: {},
  };
}

function makeState(overrides: Partial<SprintState> = {}): SprintState {
  return {
    version: STATE_VERSION,
    sprintNumber: 3,
    phase: "plan",
    startedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "state-mgr-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveState / loadState", () => {
  it("saveState creates file and loadState reads it back", () => {
    const filePath = path.join(tmpDir, "state.json");
    const state = makeState();

    saveState(state, filePath);
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = loadState(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.sprintNumber).toBe(state.sprintNumber);
    expect(loaded!.phase).toBe(state.phase);
    expect(loaded!.version).toBe(STATE_VERSION);
    expect(loaded!.startedAt).toEqual(state.startedAt);
  });

  it("saveState atomic write leaves no .tmp file", () => {
    const filePath = path.join(tmpDir, "state.json");
    saveState(makeState(), filePath);

    expect(fs.existsSync(filePath + ".tmp")).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("loadState throws on version mismatch", () => {
    const filePath = path.join(tmpDir, "state.json");
    const badData = JSON.stringify({
      version: "999",
      sprintNumber: 1,
      phase: "plan",
      startedAt: new Date().toISOString(),
    });
    fs.writeFileSync(filePath, badData, "utf-8");

    expect(() => loadState(filePath)).toThrow("Incompatible sprint state version");
  });
});

describe("getStatePath", () => {
  it("builds correct path from config", () => {
    const config = makeConfig("/my/project");
    const result = getStatePath(config);

    expect(result).toBe(
      path.join("/my/project", "docs", "sprints", "alpha-3-state.json"),
    );
  });
});

describe("acquireLock / releaseLock", () => {
  it("acquireLock creates lock file with PID", () => {
    const config = makeConfig(tmpDir);
    acquireLock(config);

    const lockPath = getStatePath(config) + ".lock";
    expect(fs.existsSync(lockPath)).toBe(true);

    const content = fs.readFileSync(lockPath, "utf-8");
    expect(parseInt(content, 10)).toBe(process.pid);

    releaseLock(config); // cleanup
  });

  it("releaseLock removes lock file", () => {
    const config = makeConfig(tmpDir);
    acquireLock(config);

    const lockPath = getStatePath(config) + ".lock";
    expect(fs.existsSync(lockPath)).toBe(true);

    releaseLock(config);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("acquireLock throws if another process holds lock", () => {
    const config = makeConfig(tmpDir);
    const lockPath = getStatePath(config) + ".lock";

    // Write current PID (alive process) to simulate another holder
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));

    expect(() => acquireLock(config)).toThrow("already running");

    releaseLock(config); // cleanup
  });

  it("acquireLock takes over stale lock", () => {
    const config = makeConfig(tmpDir);
    const lockPath = getStatePath(config) + ".lock";

    // Write a non-existent PID to simulate a stale lock
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "999999999");

    // Should succeed by taking over the stale lock
    expect(() => acquireLock(config)).not.toThrow();

    const content = fs.readFileSync(lockPath, "utf-8");
    expect(parseInt(content, 10)).toBe(process.pid);

    releaseLock(config); // cleanup
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QualityGateConfig } from "../../src/enforcement/quality-gate.js";

// Mock dependencies before importing the module under test
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../src/git/diff-analysis.js", () => ({
  diffStat: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { runQualityGate } from "../../src/enforcement/quality-gate.js";
import { glob } from "glob";
import { diffStat } from "../../src/git/diff-analysis.js";

// The module uses promisify(execFile), so we need to mock at the right level.
// Since the module calls promisify on import, we mock the underlying execFile
// to behave like a callback-based function that promisify can wrap.
import { execFile } from "node:child_process";

const mockGlob = vi.mocked(glob);
const mockDiffStat = vi.mocked(diffStat);
const mockExecFile = vi.mocked(execFile);

function makeConfig(overrides: Partial<QualityGateConfig> = {}): QualityGateConfig {
  return {
    requireTests: true,
    requireLint: true,
    requireTypes: true,
    maxDiffLines: 500,
    testCommand: "npm test",
    lintCommand: "npm run lint",
    typecheckCommand: "npm run typecheck",
    ...overrides,
  };
}

function mockExecSuccess(): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
      if (cb) {
        cb(null, { stdout: "ok", stderr: "" });
      } else {
        // promisify path — return value is ignored; promisify wraps the callback
        // We need to handle the 3-arg case (cmd, args, callback) for promisify
        const lastArg = _opts;
        if (typeof lastArg === "function") {
          lastArg(null, { stdout: "ok", stderr: "" });
        }
      }
    }) as unknown as typeof execFile,
  );
}

function mockExecFailure(): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: Function) => {
      const err = new Error("command failed");
      if (cb) {
        cb(err);
      } else {
        const lastArg = _opts;
        if (typeof lastArg === "function") {
          lastArg(err);
        }
      }
    }) as unknown as typeof execFile,
  );
}

describe("runQualityGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiffStat.mockResolvedValue({ linesChanged: 100, filesChanged: 3, files: ["a.ts", "b.ts", "c.ts"] });
  });

  it("should pass when all checks succeed", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("should fail when tests do not exist", async () => {
    mockGlob.mockResolvedValue([] as never);
    mockExecSuccess();

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(false);
    const testsExist = result.checks.find((c) => c.name === "tests-exist");
    expect(testsExist?.passed).toBe(false);
  });

  it("should fail when commands fail", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecFailure();

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(false);
    const testsPass = result.checks.find((c) => c.name === "tests-pass");
    expect(testsPass?.passed).toBe(false);
    const lintClean = result.checks.find((c) => c.name === "lint-clean");
    expect(lintClean?.passed).toBe(false);
  });

  it("should fail when diff exceeds max lines", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();
    mockDiffStat.mockResolvedValue({ linesChanged: 1000, filesChanged: 10, files: [] });

    const result = await runQualityGate(
      makeConfig({ maxDiffLines: 500 }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(false);
    const diffSize = result.checks.find((c) => c.name === "diff-size");
    expect(diffSize?.passed).toBe(false);
    expect(diffSize?.detail).toContain("1000");
  });

  it("should skip tests/lint/types checks when not required", async () => {
    mockDiffStat.mockResolvedValue({ linesChanged: 10, filesChanged: 1, files: ["a.ts"] });

    const result = await runQualityGate(
      makeConfig({ requireTests: false, requireLint: false, requireTypes: false }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(true);
    // Only diff-size check
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.name).toBe("diff-size");
  });

  it("should run all checks even if some fail", async () => {
    mockGlob.mockResolvedValue([] as never); // no test files
    mockExecFailure(); // commands fail

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    // All 5 checks should be present despite failures
    expect(result.checks).toHaveLength(5);
    expect(result.passed).toBe(false);
  });
});

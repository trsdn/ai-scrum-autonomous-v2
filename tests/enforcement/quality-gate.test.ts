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
    requireBuild: false,
    maxDiffLines: 500,
    testCommand: ["npm", "test"],
    lintCommand: ["npm", "run", "lint"],
    typecheckCommand: ["npm", "run", "typecheck"],
    buildCommand: ["npm", "run", "build"],
    ...overrides,
  };
}

function mockExecSuccess(): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: (...a: unknown[]) => void) => {
      if (cb) {
        cb(null, { stdout: "ok", stderr: "" });
      } else {
        // promisify path — return value is ignored; promisify wraps the callback
        // We need to handle the 3-arg case (cmd, args, callback) for promisify
        const lastArg = _opts;
        if (typeof lastArg === "function") {
          (lastArg as (...a: unknown[]) => void)(null, { stdout: "ok", stderr: "" });
        }
      }
    }) as unknown as typeof execFile,
  );
}

function mockExecFailure(): void {
  mockExecFile.mockImplementation(
    ((_cmd: unknown, _args: unknown, _opts: unknown, cb?: (...a: unknown[]) => void) => {
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

    // Verify categories
    expect(result.checks.find((c) => c.name === "tests-exist")?.category).toBe("test");
    expect(result.checks.find((c) => c.name === "tests-pass")?.category).toBe("test");
    expect(result.checks.find((c) => c.name === "lint-clean")?.category).toBe("lint");
    expect(result.checks.find((c) => c.name === "types-clean")?.category).toBe("type");
    expect(result.checks.find((c) => c.name === "diff-size")?.category).toBe("diff");
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
      makeConfig({ requireTests: false, requireLint: false, requireTypes: false, requireBuild: false }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(true);
    // Only diff-size check
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.name).toBe("diff-size");
    expect(result.checks[0]!.category).toBe("diff");
  });

  it("should run and pass build check when requireBuild is true", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const result = await runQualityGate(
      makeConfig({ requireBuild: true }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(true);
    const buildCheck = result.checks.find((c) => c.name === "build-pass");
    expect(buildCheck).toBeDefined();
    expect(buildCheck?.passed).toBe(true);
    expect(buildCheck?.category).toBe("build");
    // 5 standard checks + 1 build check
    expect(result.checks).toHaveLength(6);
  });

  it("should fail when build fails", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecFailure();

    const result = await runQualityGate(
      makeConfig({ requireBuild: true }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(false);
    const buildCheck = result.checks.find((c) => c.name === "build-pass");
    expect(buildCheck?.passed).toBe(false);
  });

  it("should run all checks even if some fail", async () => {
    mockGlob.mockResolvedValue([] as never); // no test files
    mockExecFailure(); // commands fail

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    // All 5 checks should be present despite failures
    expect(result.checks).toHaveLength(5);
    expect(result.passed).toBe(false);
  });

  it("should handle commands as arrays correctly", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const config = makeConfig({
      testCommand: ["npx", "vitest", "run"],
      lintCommand: ["npx", "eslint", "src/"],
      typecheckCommand: ["npx", "tsc", "--noEmit"],
    });

    const result = await runQualityGate(config, "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(true);
    // Verify execFile was called with correct array args
    expect(mockExecFile).toHaveBeenCalledWith(
      "npx",
      ["vitest", "run"],
      expect.objectContaining({ cwd: "/tmp/wt" }),
      expect.any(Function),
    );
  });

  it("should handle command with spaces in path", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const config = makeConfig({
      testCommand: ["/path/to/my project/node_modules/.bin/vitest", "run"],
      requireLint: false,
      requireTypes: false,
    });

    const result = await runQualityGate(config, "/tmp/my worktree", "feat/1", "main");

    expect(result.passed).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "/path/to/my project/node_modules/.bin/vitest",
      ["run"],
      expect.objectContaining({ cwd: "/tmp/my worktree" }),
      expect.any(Function),
    );
  });

  it("should pass scope-drift when expectedFiles match changed files", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const result = await runQualityGate(
      makeConfig({ expectedFiles: ["a.ts", "b.ts", "c.ts"] }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(true);
    const scopeDrift = result.checks.find((c) => c.name === "scope-drift");
    expect(scopeDrift).toBeDefined();
    expect(scopeDrift?.passed).toBe(true);
    expect(scopeDrift?.detail).toContain("within expected scope");
  });

  it("should fail scope-drift when unplanned files exist", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const result = await runQualityGate(
      makeConfig({ expectedFiles: ["a.ts"] }),
      "/tmp/wt",
      "feat/1",
      "main",
    );

    expect(result.passed).toBe(false);
    const scopeDrift = result.checks.find((c) => c.name === "scope-drift");
    expect(scopeDrift).toBeDefined();
    expect(scopeDrift?.passed).toBe(false);
    expect(scopeDrift?.detail).toContain("out-of-scope");
  });

  it("should not add scope-drift check when expectedFiles is not set", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    const result = await runQualityGate(makeConfig(), "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(true);
    const scopeDrift = result.checks.find((c) => c.name === "scope-drift");
    expect(scopeDrift).toBeUndefined();
  });

  it("should handle legacy string commands with a fallback", async () => {
    mockGlob.mockResolvedValue(["foo.test.ts"] as never);
    mockExecSuccess();

    // Pass string (legacy) — should still work via fallback
    const config = makeConfig({
      testCommand: "npm test" as unknown as string[],
      requireLint: false,
      requireTypes: false,
    });

    const result = await runQualityGate(config, "/tmp/wt", "feat/1", "main");

    expect(result.passed).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "npm",
      ["test"],
      expect.objectContaining({ cwd: "/tmp/wt" }),
      expect.any(Function),
    );
  });
});

describe("verifyMainBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when tests and types succeed", async () => {
    mockExecSuccess();

    const { verifyMainBranch } = await import("../../src/enforcement/quality-gate.js");
    const result = await verifyMainBranch("/tmp/project", {
      testCommand: ["npm", "test"],
      typecheckCommand: ["npx", "tsc", "--noEmit"],
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.find((c) => c.name === "post-merge-tests")?.passed).toBe(true);
    expect(result.checks.find((c) => c.name === "post-merge-types")?.passed).toBe(true);
  });

  it("fails when tests fail on main", async () => {
    mockExecFailure();

    const { verifyMainBranch } = await import("../../src/enforcement/quality-gate.js");
    const result = await verifyMainBranch("/tmp/project", {
      testCommand: ["npm", "test"],
      typecheckCommand: ["npx", "tsc", "--noEmit"],
    });

    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "post-merge-tests")?.passed).toBe(false);
  });
});

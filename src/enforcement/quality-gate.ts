import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";
import { diffStat } from "../git/diff-analysis.js";
import { logger } from "../logger.js";
import type { QualityCheck, QualityResult } from "../types.js";

const execFile = promisify(execFileCb);

export interface QualityGateConfig {
  requireTests: boolean;
  requireLint: boolean;
  requireTypes: boolean;
  requireBuild: boolean;
  maxDiffLines: number;
  testCommand: string | string[];
  lintCommand: string | string[];
  typecheckCommand: string | string[];
  buildCommand: string | string[];
  expectedFiles?: string[];
}

/** Normalize a command to an array, logging a warning for legacy string usage. */
function normalizeCommand(command: string | string[]): string[] {
  if (Array.isArray(command)) {
    if (command.length === 0) {
      throw new Error("Command array cannot be empty");
    }
    return command;
  }
  const log = logger.child({ module: "quality-gate" });
  log.warn(
    { command },
    "Command passed as string — splitting on spaces as fallback. Prefer string[] to support paths with spaces.",
  );
  const parts = command.split(" ");
  if (parts.length === 0 || parts[0] === "") {
    throw new Error("Command string cannot be empty");
  }
  return parts;
}

async function runCommand(
  command: string | string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  const parts = normalizeCommand(command);
  const [cmd, ...args] = parts;
  try {
    const { stdout, stderr } = await execFile(cmd!, args, { cwd });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, output: msg };
  }
}

export async function runQualityGate(
  config: QualityGateConfig,
  worktreePath: string,
  branch: string,
  baseBranch: string,
): Promise<QualityResult> {
  const log = logger.child({ module: "quality-gate" });
  const checks: QualityCheck[] = [];

  // 1. Check tests exist
  if (config.requireTests) {
    const testFiles = await glob("**/*.test.{ts,js,tsx,jsx}", {
      cwd: worktreePath,
      ignore: ["node_modules/**"],
    });
    checks.push({
      name: "tests-exist",
      passed: testFiles.length > 0,
      detail:
        testFiles.length > 0
          ? `Found ${testFiles.length} test file(s)`
          : "No test files found",
      category: "test",
    });
  }

  // 2. Check tests pass
  if (config.requireTests) {
    const result = await runCommand(config.testCommand, worktreePath);
    checks.push({
      name: "tests-pass",
      passed: result.ok,
      detail: result.ok ? "Tests passed" : result.output,
      category: "test",
    });
  }

  // 3. Check lint clean
  if (config.requireLint) {
    const result = await runCommand(config.lintCommand, worktreePath);
    checks.push({
      name: "lint-clean",
      passed: result.ok,
      detail: result.ok ? "Lint clean" : result.output,
      category: "lint",
    });
  }

  // 4. Check types clean
  if (config.requireTypes) {
    const result = await runCommand(config.typecheckCommand, worktreePath);
    checks.push({
      name: "types-clean",
      passed: result.ok,
      detail: result.ok ? "Types clean" : result.output,
      category: "type",
    });
  }

  // 5. Check build succeeds
  if (config.requireBuild) {
    const result = await runCommand(config.buildCommand, worktreePath);
    checks.push({
      name: "build-pass",
      passed: result.ok,
      detail: result.ok ? "Build succeeded" : result.output,
      category: "build",
    });
  }

  // 6. Compute diff stat (reused by scope-drift and diff-size checks)
  const stat = await diffStat(branch, baseBranch);

  // 7. Check scope drift (if expectedFiles provided)
  if (config.expectedFiles && config.expectedFiles.length > 0) {
    const changedFiles = stat.files;
    const unplannedFiles = changedFiles.filter(
      (f) => !config.expectedFiles!.some((ef) => f.includes(ef)),
    );
    checks.push({
      name: "scope-drift",
      passed: unplannedFiles.length === 0,
      detail:
        unplannedFiles.length === 0
          ? `All ${changedFiles.length} changed files within expected scope`
          : `${unplannedFiles.length} out-of-scope files: ${unplannedFiles.slice(0, 5).join(", ")}${unplannedFiles.length > 5 ? "..." : ""}`,
      category: "diff",
    });
  }

  // 8. Check diff size
  const diffPassed = stat.linesChanged <= config.maxDiffLines;
  checks.push({
    name: "diff-size",
    passed: diffPassed,
    detail: diffPassed
      ? `${stat.linesChanged} lines changed (max ${config.maxDiffLines})`
      : `${stat.linesChanged} lines changed exceeds max ${config.maxDiffLines}`,
    category: "diff",
  });

  const passed = checks.every((c) => c.passed);

  log.info(
    { passed, totalChecks: checks.length, failed: checks.filter((c) => !c.passed).length },
    "quality gate %s",
    passed ? "passed" : "failed",
  );

  return { passed, checks };
}

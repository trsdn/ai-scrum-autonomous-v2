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
  maxDiffLines: number;
  testCommand: string;
  lintCommand: string;
  typecheckCommand: string;
}

async function runCommand(
  command: string,
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  const [cmd, ...args] = command.split(" ");
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
    });
  }

  // 2. Check tests pass
  if (config.requireTests) {
    const result = await runCommand(config.testCommand, worktreePath);
    checks.push({
      name: "tests-pass",
      passed: result.ok,
      detail: result.ok ? "Tests passed" : result.output,
    });
  }

  // 3. Check lint clean
  if (config.requireLint) {
    const result = await runCommand(config.lintCommand, worktreePath);
    checks.push({
      name: "lint-clean",
      passed: result.ok,
      detail: result.ok ? "Lint clean" : result.output,
    });
  }

  // 4. Check types clean
  if (config.requireTypes) {
    const result = await runCommand(config.typecheckCommand, worktreePath);
    checks.push({
      name: "types-clean",
      passed: result.ok,
      detail: result.ok ? "Types clean" : result.output,
    });
  }

  // 5. Check diff size
  const stat = await diffStat(branch, baseBranch);
  const diffPassed = stat.linesChanged <= config.maxDiffLines;
  checks.push({
    name: "diff-size",
    passed: diffPassed,
    detail: diffPassed
      ? `${stat.linesChanged} lines changed (max ${config.maxDiffLines})`
      : `${stat.linesChanged} lines changed exceeds max ${config.maxDiffLines}`,
  });

  const passed = checks.every((c) => c.passed);

  log.info(
    { passed, totalChecks: checks.length, failed: checks.filter((c) => !c.passed).length },
    "quality gate %s",
    passed ? "passed" : "failed",
  );

  return { passed, checks };
}

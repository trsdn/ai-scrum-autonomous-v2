#!/usr/bin/env npx tsx
/**
 * Prompt Bench — Agent Prompt Calibration Framework
 *
 * Feeds examples through ACP agent sessions and measures accuracy
 * against expected outcomes. Used for prompt tuning.
 *
 * Usage:
 *   npx tsx scripts/prompt-bench/bench.ts --role code-review
 *   npx tsx scripts/prompt-bench/bench.ts --role code-review --model claude-sonnet-4.6
 *   npx tsx scripts/prompt-bench/bench.ts --report
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AcpClient } from "../../src/acp/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeReviewExample {
  id: string;
  description: string;
  issueTitle: string;
  issueNumber: number;
  acceptanceCriteria: string;
  codeDiff: string;
  diffStats: { filesChanged: number; linesChanged: number };
  branch: string;
  expected: {
    approved: boolean;
    mustContain?: string[];
    mustNotContain?: string[];
  };
}

interface BenchResult {
  id: string;
  expected: boolean;
  actual: boolean;
  passed: boolean;
  response: string;
  issues: string[];
  duration_ms: number;
}

interface BenchReport {
  role: string;
  model: string;
  timestamp: string;
  total: number;
  correct: number;
  accuracy: number;
  falsePositives: number;   // approved but should have rejected
  falseNegatives: number;   // rejected but should have approved
  results: BenchResult[];
}

// ---------------------------------------------------------------------------
// Prompt Builder (code-review role)
// ---------------------------------------------------------------------------

function buildCodeReviewPrompt(example: CodeReviewExample): string {
  return [
    "You are a code reviewer. Review the following code diff.",
    "DO NOT use any tools. DO NOT read files. Just analyze the diff provided below.",
    "",
    "Focus ONLY on:",
    "- Bugs and logic errors",
    "- Security vulnerabilities",
    "- Missing error handling",
    "- Breaking API changes",
    "",
    "Do NOT comment on style, formatting, naming, or minor improvements.",
    "",
    `## Issue #${example.issueNumber}: ${example.issueTitle}`,
    "",
    "### Acceptance Criteria",
    example.acceptanceCriteria,
    "",
    `### Diff Stats: ${example.diffStats.filesChanged} files, ${example.diffStats.linesChanged} lines changed`,
    `### Branch: ${example.branch}`,
    "",
    "### Code Diff",
    "```diff",
    example.codeDiff,
    "```",
    "",
    "Respond with exactly one of:",
    "- First line: `APPROVED: <one-line summary>` if the changes are acceptable",
    "- First line: `CHANGES_REQUESTED: <one-line summary>` if there are blocking issues",
    "",
    "Then list any issues found (one per line, prefixed with `- `).",
    "Mark non-blocking suggestions with `[suggestion]` prefix.",
  ].join("\n");
}

function parseCodeReviewResponse(response: string): { approved: boolean; issues: string[] } {
  const firstLine = response.split("\n")[0] ?? "";
  const approved = firstLine.toUpperCase().startsWith("APPROVED");
  const issues = response
    .split("\n")
    .filter((l) => l.trim().startsWith("- ") && !l.includes("[suggestion]"))
    .map((l) => l.trim().replace(/^- /, ""));
  return { approved, issues };
}

// ---------------------------------------------------------------------------
// Main bench runner
// ---------------------------------------------------------------------------

async function loadExamples(dir: string): Promise<CodeReviewExample[]> {
  const examples: CodeReviewExample[] = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    if (Array.isArray(content)) {
      examples.push(...content);
    } else {
      examples.push(content);
    }
  }

  return examples;
}

async function runBench(
  examplesDir: string,
  model?: string,
  projectDir?: string,
): Promise<BenchReport> {
  const examples = await loadExamples(examplesDir);
  console.log(`\n📋 Loaded ${examples.length} examples from ${examplesDir}\n`);

  const cwd = projectDir ?? process.cwd();
  const client = new AcpClient({ timeoutMs: 120_000 });

  try {
    await client.connect();
    console.log("🔌 ACP connected\n");

    const results: BenchResult[] = [];

    for (const example of examples) {
      const start = Date.now();
      process.stdout.write(`  Running: ${example.id}... `);

      try {
        const { sessionId } = await client.createSession({ cwd });

        if (model) {
          await client.setModel(sessionId, model);
        }

        const prompt = buildCodeReviewPrompt(example);
        const { response } = await client.sendPrompt(sessionId, prompt, 120_000);
        const parsed = parseCodeReviewResponse(response);

        const passed = parsed.approved === example.expected.approved;
        const duration_ms = Date.now() - start;

        // Check mustContain (any match) / mustNotContain (all must be absent)
        let contentPassed = true;
        if (example.expected.mustContain && example.expected.mustContain.length > 0) {
          const lower = response.toLowerCase();
          const anyMatch = example.expected.mustContain.some((phrase) =>
            lower.includes(phrase.toLowerCase()),
          );
          if (!anyMatch) contentPassed = false;
        }
        if (example.expected.mustNotContain) {
          for (const phrase of example.expected.mustNotContain) {
            if (response.toLowerCase().includes(phrase.toLowerCase())) {
              contentPassed = false;
            }
          }
        }

        const finalPassed = passed && contentPassed;

        results.push({
          id: example.id,
          expected: example.expected.approved,
          actual: parsed.approved,
          passed: finalPassed,
          response: response.substring(0, 500),
          issues: parsed.issues,
          duration_ms,
        });

        console.log(
          finalPassed ? `✅ (${duration_ms}ms)` : `❌ expected=${example.expected.approved ? "approve" : "reject"} got=${parsed.approved ? "approve" : "reject"} (${duration_ms}ms)`,
        );

        await client.endSession(sessionId).catch(() => {});
      } catch (err) {
        const duration_ms = Date.now() - start;
        console.log(`💥 ERROR: ${err instanceof Error ? err.message : String(err)}`);
        results.push({
          id: example.id,
          expected: example.expected.approved,
          actual: false,
          passed: false,
          response: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
          issues: [],
          duration_ms,
        });
      }
    }

    const correct = results.filter((r) => r.passed).length;
    const falsePositives = results.filter((r) => r.actual && !r.expected).length;
    const falseNegatives = results.filter((r) => !r.actual && r.expected).length;

    const report: BenchReport = {
      role: "code-review",
      model: model ?? "default",
      timestamp: new Date().toISOString(),
      total: results.length,
      correct,
      accuracy: Math.round((correct / results.length) * 100),
      falsePositives,
      falseNegatives,
      results,
    };

    return report;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

function printReport(report: BenchReport): void {
  console.log("\n═══════════════════════════════════════════");
  console.log("📊 PROMPT BENCH REPORT");
  console.log("═══════════════════════════════════════════");
  console.log(`  Role:      ${report.role}`);
  console.log(`  Model:     ${report.model}`);
  console.log(`  Timestamp: ${report.timestamp}`);
  console.log(`  Examples:  ${report.total}`);
  console.log(`  Correct:   ${report.correct}/${report.total} (${report.accuracy}%)`);
  console.log(`  False ✅:  ${report.falsePositives} (approved but should reject)`);
  console.log(`  False ❌:  ${report.falseNegatives} (rejected but should approve)`);
  console.log("═══════════════════════════════════════════");

  if (report.results.some((r) => !r.passed)) {
    console.log("\n❌ Failed examples:");
    for (const r of report.results.filter((r) => !r.passed)) {
      console.log(`  ${r.id}: expected=${r.expected ? "approve" : "reject"} actual=${r.actual ? "approve" : "reject"}`);
      if (r.issues.length > 0) {
        console.log(`    Issues: ${r.issues.join("; ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--report")) {
    const reportFile = path.join(__dirname, "results", "latest.json");
    if (fs.existsSync(reportFile)) {
      const report = JSON.parse(fs.readFileSync(reportFile, "utf-8")) as BenchReport;
      printReport(report);
    } else {
      console.log("No results found. Run a bench first.");
    }
    return;
  }

  const roleIdx = args.indexOf("--role");
  const role = roleIdx >= 0 ? args[roleIdx + 1] : "code-review";

  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;

  const projectIdx = args.indexOf("--project");
  const projectDir = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

  const examplesDir = path.join(__dirname, "examples", role);

  if (!fs.existsSync(examplesDir)) {
    console.error(`Examples directory not found: ${examplesDir}`);
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════╗");
  console.log(`║  PROMPT BENCH: ${role}`);
  console.log(`║  Model: ${model ?? "default"}`);
  console.log("╚══════════════════════════════════════════╝");

  const report = await runBench(examplesDir, model, projectDir);
  printReport(report);

  // Save results
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const resultFile = path.join(resultsDir, "latest.json");
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));

  const historyFile = path.join(resultsDir, `${role}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(historyFile, JSON.stringify(report, null, 2));

  console.log(`\n📁 Results saved to ${resultFile}`);

  // Exit with failure if accuracy < 70%
  if (report.accuracy < 70) {
    console.log(`\n❌ Accuracy ${report.accuracy}% below 70% threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Prompt Bench — Agent Prompt Calibration Framework
 *
 * Feeds examples through ACP agent sessions and measures accuracy
 * against expected outcomes. Used for prompt tuning across all agent roles.
 *
 * Usage:
 *   npx tsx scripts/prompt-bench/bench.ts --role code-review
 *   npx tsx scripts/prompt-bench/bench.ts --role planner --model claude-sonnet-4.6
 *   npx tsx scripts/prompt-bench/bench.ts --report
 *   npx tsx scripts/prompt-bench/bench.ts --role all   # run all roles
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

/** Generic example — every role must have at least these fields. */
interface BaseExample {
  id: string;
  description: string;
  expected: {
    passed: boolean;
    mustContain?: string[];
    mustNotContain?: string[];
  };
  [key: string]: unknown;
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
  falsePositives: number;
  falseNegatives: number;
  results: BenchResult[];
}

/** Role adapter — pluggable prompt builder + response parser per role. */
interface RoleAdapter {
  buildPrompt(example: BaseExample): string;
  parseResponse(response: string): { passed: boolean; issues: string[] };
}

// ---------------------------------------------------------------------------
// Role: code-review
// ---------------------------------------------------------------------------

const codeReviewAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    const diffStats = ex.diffStats as { filesChanged: number; linesChanged: number };
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
      `## Issue #${ex.issueNumber}: ${ex.issueTitle}`,
      "",
      "### Acceptance Criteria",
      String(ex.acceptanceCriteria),
      "",
      `### Diff Stats: ${diffStats.filesChanged} files, ${diffStats.linesChanged} lines changed`,
      `### Branch: ${ex.branch}`,
      "",
      "### Code Diff",
      "```diff",
      String(ex.codeDiff),
      "```",
      "",
      "Respond with exactly one of:",
      "- First line: `APPROVED: <one-line summary>` if the changes are acceptable",
      "- First line: `CHANGES_REQUESTED: <one-line summary>` if there are blocking issues",
      "",
      "Then list any issues found (one per line, prefixed with `- `).",
      "Mark non-blocking suggestions with `[suggestion]` prefix.",
    ].join("\n");
  },
  parseResponse(response) {
    const firstLine = response.trim().split("\n")[0] ?? "";
    const passed = firstLine.toUpperCase().startsWith("APPROVED");
    const issues = response
      .split("\n")
      .filter((l) => l.trim().startsWith("- ") && !l.includes("[suggestion]"))
      .map((l) => l.trim().replace(/^- /, ""));
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: planner (sprint planning)
// ---------------------------------------------------------------------------

const plannerAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are a sprint planning agent. Select and sequence issues for the sprint.",
      "DO NOT use any tools. Just analyze the backlog provided below.",
      "",
      "## Sprint Context",
      `- Max issues: ${ex.maxIssues}`,
      `- Velocity (story points): ${ex.velocity}`,
      `- Sprint number: ${ex.sprintNumber}`,
      "",
      "### Backlog Issues",
      String(ex.backlog),
      "",
      ex.dependencies ? `### Dependencies\n${ex.dependencies}\n` : "",
      ex.previousSprint ? `### Previous Sprint Summary\n${ex.previousSprint}\n` : "",
      "",
      "## Rules",
      "- Respect priority labels (priority:critical > priority:high > priority:medium > priority:low)",
      "- Do NOT exceed velocity capacity",
      "- Respect dependencies — dependent issues must come after their prerequisites",
      "- Prefer finishing in-progress work over starting new work",
      "",
      "## Response Format",
      "Respond with a JSON object:",
      "```json",
      '{ "selected": [{ "number": 1, "title": "...", "points": 3, "reason": "..." }], "excluded": [{ "number": 5, "reason": "..." }] }',
      "```",
      "First line must be: `SPRINT_PLAN:` followed by the JSON.",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const passed = trimmed.toUpperCase().startsWith("SPRINT_PLAN:");
    const issues: string[] = [];
    // Extract JSON if present
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) issues.push("No JSON found in response");
    else {
      try {
        const plan = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(plan.selected)) issues.push("Missing 'selected' array");
      } catch { issues.push("Invalid JSON in response"); }
    }
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: refinement (backlog refinement)
// ---------------------------------------------------------------------------

const refinementAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are a backlog refinement agent. Refine the following idea into a concrete, implementable issue.",
      "DO NOT use any tools.",
      "",
      `## Idea Issue #${ex.issueNumber}: ${ex.ideaTitle}`,
      "",
      "### Original Description",
      String(ex.ideaBody),
      "",
      ex.projectContext ? `### Project Context\n${ex.projectContext}\n` : "",
      "",
      "## Your Task",
      "Transform this idea into a well-defined backlog issue with:",
      "1. A clear, actionable title",
      "2. Testable acceptance criteria (specific, measurable)",
      "3. Technical notes on implementation approach",
      "4. Story point estimate (1, 2, 3, 5, 8, 13)",
      "5. Suggested labels",
      "",
      "## Response Format",
      "First line: `REFINED:`",
      "Then the refined issue in this format:",
      "```",
      "Title: <refined title>",
      "Points: <estimate>",
      "Labels: <comma-separated>",
      "AC:",
      "- <criterion 1>",
      "- <criterion 2>",
      "Notes: <technical notes>",
      "```",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const passed = trimmed.toUpperCase().startsWith("REFINED:");
    const issues: string[] = [];
    if (!trimmed.includes("AC:")) issues.push("Missing acceptance criteria section");
    if (!trimmed.match(/Points:\s*\d+/)) issues.push("Missing story point estimate");
    const acLines = trimmed.split("\n").filter((l) => l.trim().startsWith("- "));
    if (acLines.length < 2) issues.push("Fewer than 2 acceptance criteria");
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: item-planner
// ---------------------------------------------------------------------------

const itemPlannerAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are an item planner agent. Create a detailed implementation plan.",
      "DO NOT use any tools. DO NOT make any code changes.",
      "",
      `## Issue #${ex.issueNumber}: ${ex.issueTitle}`,
      "",
      "### Acceptance Criteria",
      String(ex.acceptanceCriteria),
      "",
      "### Codebase Context",
      String(ex.codebaseContext),
      "",
      "## Your Task",
      "Create a step-by-step implementation plan covering:",
      "1. Files to modify or create",
      "2. Implementation steps in order",
      "3. Test strategy",
      "4. Risks and edge cases",
      "",
      "## Response Format",
      "First line: `PLAN:`",
      "Then numbered steps, each with file paths and what to do.",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const passed = trimmed.toUpperCase().startsWith("PLAN:");
    const issues: string[] = [];
    const steps = trimmed.split("\n").filter((l) => l.match(/^\d+\./));
    if (steps.length < 2) issues.push("Fewer than 2 plan steps");
    if (!trimmed.toLowerCase().includes("test")) issues.push("No test strategy mentioned");
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: retro (sprint retrospective)
// ---------------------------------------------------------------------------

const retroAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are a sprint retrospective agent. Analyze sprint data and suggest improvements.",
      "DO NOT use any tools.",
      "",
      `## Sprint ${ex.sprintNumber} Data`,
      "",
      "### Sprint Results",
      String(ex.sprintResults),
      "",
      ex.velocityData ? `### Velocity Data\n${ex.velocityData}\n` : "",
      ex.previousImprovements ? `### Previous Improvements\n${ex.previousImprovements}\n` : "",
      "",
      "## Your Task",
      "Identify data-driven improvements. For each improvement:",
      "1. What went well / what didn't",
      "2. Root cause (not symptoms)",
      "3. Concrete action with target (skill, agent, config, or process)",
      "4. Expected impact",
      "",
      "## Response Format",
      "First line: `RETRO:`",
      "Then for each improvement:",
      "```",
      "## Improvement: <title>",
      "Target: <skill|agent|config|process>",
      "Action: <what to change>",
      "Impact: <expected improvement>",
      "```",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const passed = trimmed.toUpperCase().startsWith("RETRO:");
    const issues: string[] = [];
    const improvements = trimmed.split("## Improvement:").length - 1;
    if (improvements < 1) issues.push("No improvements identified");
    const targets = ["skill", "agent", "config", "process"];
    const hasTarget = targets.some((t) => trimmed.toLowerCase().includes(`target: ${t}`));
    if (!hasTarget) issues.push("No valid target specified");
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: sprint-review
// ---------------------------------------------------------------------------

const sprintReviewAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are a sprint review agent. Create a stakeholder-facing sprint summary.",
      "DO NOT use any tools.",
      "",
      `## Sprint ${ex.sprintNumber} Data`,
      "",
      "### Issues",
      String(ex.sprintIssues),
      "",
      ex.velocityData ? `### Velocity Data\n${ex.velocityData}\n` : "",
      ex.mergedPRs ? `### Merged PRs\n${ex.mergedPRs}\n` : "",
      "",
      "## Your Task",
      "Create a sprint review summary covering:",
      "1. What was delivered (completed issues with PR links)",
      "2. What was not delivered and why (carryover items)",
      "3. Velocity analysis (planned vs actual)",
      "4. Key metrics and observations",
      "",
      "## Response Format",
      "First line: `REVIEW:`",
      "Then structured summary with sections.",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const passed = trimmed.toUpperCase().startsWith("REVIEW:");
    const issues: string[] = [];
    if (!trimmed.toLowerCase().includes("deliver")) issues.push("Missing delivery section");
    if (!trimmed.toLowerCase().includes("velocity")) issues.push("Missing velocity analysis");
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role: challenger (adversarial review)
// ---------------------------------------------------------------------------

const challengerAdapter: RoleAdapter = {
  buildPrompt(example) {
    const ex = example as Record<string, unknown>;
    return [
      "You are the Challenger agent — a devil's advocate that reviews decisions and plans.",
      "DO NOT use any tools.",
      "",
      `## Decision/Plan to Review`,
      String(ex.decision),
      "",
      ex.context ? `### Context\n${ex.context}\n` : "",
      "",
      "## Your Task",
      "Challenge this decision/plan by:",
      "1. Identifying assumptions that may be wrong",
      "2. Finding blind spots or risks not considered",
      "3. Checking for scope creep or drift from goals",
      "4. Suggesting alternatives if the approach is flawed",
      "",
      "## Rules",
      "- Only flag genuine risks, not hypothetical nitpicks",
      "- Be constructive — suggest fixes, not just problems",
      "- Rate severity: BLOCKER, WARNING, or INFO",
      "",
      "## Response Format",
      "First line: `CHALLENGE:` followed by overall assessment (APPROVE / PUSH_BACK)",
      "Then list findings with severity.",
    ].join("\n");
  },
  parseResponse(response) {
    const trimmed = response.trim();
    const firstLine = trimmed.split("\n")[0] ?? "";
    const passed = firstLine.toUpperCase().startsWith("CHALLENGE:");
    const issues: string[] = [];
    if (!firstLine.includes("APPROVE") && !firstLine.includes("PUSH_BACK")) {
      issues.push("Missing APPROVE or PUSH_BACK verdict");
    }
    return { passed, issues };
  },
};

// ---------------------------------------------------------------------------
// Role registry
// ---------------------------------------------------------------------------

const ROLE_ADAPTERS: Record<string, RoleAdapter> = {
  "code-review": codeReviewAdapter,
  "planner": plannerAdapter,
  "refinement": refinementAdapter,
  "item-planner": itemPlannerAdapter,
  "retro": retroAdapter,
  "sprint-review": sprintReviewAdapter,
  "challenger": challengerAdapter,
};

// Backward compat: code-review examples use expected.approved, others use expected.passed
function normalizeExpected(example: BaseExample, role: string): boolean {
  if (role === "code-review") {
    return (example.expected as Record<string, unknown>).approved as boolean;
  }
  return example.expected.passed;
}

// ---------------------------------------------------------------------------
// Main bench runner
// ---------------------------------------------------------------------------

function loadExamples(dir: string): BaseExample[] {
  const examples: BaseExample[] = [];
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
  role: string,
  examplesDir: string,
  model?: string,
  projectDir?: string,
): Promise<BenchReport> {
  const adapter = ROLE_ADAPTERS[role];
  if (!adapter) {
    throw new Error(`Unknown role: ${role}. Available: ${Object.keys(ROLE_ADAPTERS).join(", ")}`);
  }

  const examples = loadExamples(examplesDir);
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

        const prompt = adapter.buildPrompt(example);
        const { response } = await client.sendPrompt(sessionId, prompt, 120_000);
        const parsed = adapter.parseResponse(response);

        const expectedPassed = normalizeExpected(example, role);
        const verdictMatch = parsed.passed === expectedPassed;
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

        const finalPassed = verdictMatch && contentPassed;

        results.push({
          id: example.id,
          expected: expectedPassed,
          actual: parsed.passed,
          passed: finalPassed,
          response: response.substring(0, 500),
          issues: parsed.issues,
          duration_ms,
        });

        console.log(
          finalPassed ? `✅ (${duration_ms}ms)` : `❌ expected=${expectedPassed ? "pass" : "fail"} got=${parsed.passed ? "pass" : "fail"} (${duration_ms}ms)`,
        );

        await client.endSession(sessionId).catch(() => {});
      } catch (err) {
        const duration_ms = Date.now() - start;
        console.log(`💥 ERROR: ${err instanceof Error ? err.message : String(err)}`);
        results.push({
          id: example.id,
          expected: normalizeExpected(example, role),
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

    return {
      role,
      model: model ?? "default",
      timestamp: new Date().toISOString(),
      total: results.length,
      correct,
      accuracy: Math.round((correct / results.length) * 100),
      falsePositives,
      falseNegatives,
      results,
    };
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
  console.log(`  False ✅:  ${report.falsePositives} (passed but should fail)`);
  console.log(`  False ❌:  ${report.falseNegatives} (failed but should pass)`);
  console.log("═══════════════════════════════════════════");

  if (report.results.some((r) => !r.passed)) {
    console.log("\n❌ Failed examples:");
    for (const r of report.results.filter((r) => !r.passed)) {
      console.log(`  ${r.id}: expected=${r.expected ? "pass" : "fail"} actual=${r.actual ? "pass" : "fail"}`);
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

  // Run all roles
  if (role === "all") {
    const allResults: BenchReport[] = [];
    for (const r of Object.keys(ROLE_ADAPTERS)) {
      const dir = path.join(__dirname, "examples", r);
      if (!fs.existsSync(dir) || fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length === 0) {
        console.log(`⏭️  Skipping ${r} (no examples)`);
        continue;
      }
      console.log(`\n╔══════════════════════════════════════════╗`);
      console.log(`║  PROMPT BENCH: ${r}`);
      console.log(`╚══════════════════════════════════════════╝`);
      const report = await runBench(r, dir, model, projectDir);
      printReport(report);
      allResults.push(report);
    }
    console.log("\n═══════════════════════════════════════════");
    console.log("📊 OVERALL SUMMARY");
    console.log("═══════════════════════════════════════════");
    for (const r of allResults) {
      console.log(`  ${r.role.padEnd(15)} ${r.correct}/${r.total} (${r.accuracy}%)`);
    }
    return;
  }

  const examplesDir = path.join(__dirname, "examples", role);

  if (!fs.existsSync(examplesDir)) {
    console.error(`Examples directory not found: ${examplesDir}`);
    console.error(`Available roles: ${Object.keys(ROLE_ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════╗");
  console.log(`║  PROMPT BENCH: ${role}`);
  console.log(`║  Model: ${model ?? "default"}`);
  console.log("╚══════════════════════════════════════════╝");

  const report = await runBench(role, examplesDir, model, projectDir);
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

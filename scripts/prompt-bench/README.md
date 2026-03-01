# Prompt Bench — Agent Prompt Calibration Framework

A test-driven framework for tuning agent prompts. Feed examples through any agent role, measure pass/fail rates against expected outcomes, tune, repeat.

## Quick Start

```bash
# Run code reviewer bench
npx tsx scripts/prompt-bench/bench.ts --role code-review --examples scripts/prompt-bench/examples/code-review/

# Run with specific model
npx tsx scripts/prompt-bench/bench.ts --role code-review --model claude-sonnet-4.6

# Show results from previous runs
npx tsx scripts/prompt-bench/bench.ts --report
```

## How It Works

1. **Define examples** in `examples/<role>/` as JSON files
2. **Run bench** — each example is sent through an ACP session with the agent's prompt
3. **Compare** — actual response vs expected outcome (approve/reject, key phrases)
4. **Report** — pass/fail rates, false positives, false negatives

## Example Format

```json
{
  "id": "simple-bugfix-good",
  "description": "Simple bugfix that should be approved",
  "issueTitle": "Fix null pointer in user lookup",
  "issueNumber": 42,
  "acceptanceCriteria": "- User lookup returns null instead of throwing\n- Test added for null case",
  "diffStats": { "filesChanged": 2, "linesChanged": 15 },
  "branch": "fix/null-pointer",
  "expected": {
    "approved": true,
    "mustNotContain": ["security", "breaking change"]
  }
}
```

## Adding Examples

Create JSON files in `examples/<role>/`. Each file can contain a single example or an array of examples.

### Good practices for code review examples:
- Include both "should approve" and "should reject" cases
- Cover edge cases: large diffs, test-only changes, config changes
- Include security-relevant examples (SQL injection, XSS)
- Include style-only changes that should NOT be rejected

## Extending to Other Roles

The bench works with any role that has a prompt builder. Currently supported:
- `code-review` — Tests the code reviewer agent

To add a new role, implement a `buildPrompt(example)` function in a role module.

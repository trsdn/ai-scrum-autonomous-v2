---
name: code-review
description: "Structured code review checklist. Triggers on: 'code review', 'review code', 'review PR'."
---

# Code Review

Perform a structured review of code changes.

## Steps

1. **Read diff** — Review the full diff. Understand what changed and why.
2. **Check DoD** — Verify Definition of Done: tests added/updated, no lint errors, docs updated if needed.
3. **Check tests** — Confirm new/changed code has test coverage. Run tests to verify they pass.
4. **Check scope** — Ensure changes match the issue scope. Flag any unrelated additions.
5. **Provide feedback** — Report findings. Only flag issues that genuinely matter: bugs, security, logic errors. Do not comment on style or formatting.

## Rules

- Do NOT modify code during review — only report findings.
- Focus on correctness, security, and logic. Ignore style and formatting.
- If the PR has no tests for new logic, flag as blocking.
- Verify CI status before approving: `gh pr checks <number>`.

## Expected Outputs

- Summary of changes (1-2 sentences)
- List of findings (blocking vs. non-blocking)
- Approve / Request changes recommendation

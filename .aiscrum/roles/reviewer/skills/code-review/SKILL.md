# Skill: Code Review

Perform a structured review of code changes.

## Steps

1. **Read diff** — `gh pr diff <number>`. Understand what changed and why.
2. **Check DoD** — tests added/updated, no lint errors, docs updated if needed.
3. **Check tests** — run `npx vitest run` to verify tests pass.
4. **Check scope** — ensure changes match the issue scope.
5. **Provide feedback** — only flag bugs, security issues, logic errors.

## Rules

- Do NOT modify code during review — only report findings.
- Focus on correctness, security, and logic. Ignore style and formatting.
- If the PR has no tests for new logic, flag as blocking.
- Verify CI status before approving: `gh pr checks <number>`.

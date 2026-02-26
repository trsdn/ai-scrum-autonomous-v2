---
name: create-pr
description: "Create a PR with conventional title format. Triggers on: 'create PR', 'pull request', 'submit PR'."
---

# Create Pull Request

Create a GitHub PR with conventional commit title and verify CI.

## Steps

1. **Check branch** — Confirm you are on a feature branch, not `main`. Branch name should follow `feat/<issue>-<name>` or `fix/<issue>-<name>`.
2. **Summarize changes** — Generate a concise PR description: what changed, why, and which issue it closes (e.g., `Closes #42`).
3. **Create PR** — Run `gh pr create --title "<type>(scope): description" --body "<summary>"`. Use conventional title: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
4. **Verify CI** — Wait 3-5 minutes, then check: `gh run list --branch <branch> --limit 3`. All checks must pass before merging.

## Rules

- Never create a PR from `main` to `main`.
- Title must use conventional commit format: `type(scope): description`.
- PR body must reference the issue number.
- Do NOT merge until CI is green. No exceptions.
- Use `--squash` when merging: `gh pr merge <number> --squash --delete-branch`.

## Expected Outputs

- PR created with conventional title
- PR URL printed to console
- CI status confirmed (green or red with details)

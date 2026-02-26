# {{PROJECT_NAME}} — Agent Instructions

These instructions apply to all Copilot agents working in this repository.

## Project Overview

{{PROJECT_DESCRIPTION}}

## Project Priorities

1. **Robustness over speed**: Avoid changes that fix one thing but break others
2. **Small, testable diffs**: Prefer incremental changes over large rewrites
3. **Config-driven**: Prefer configuration changes over code changes when possible

## Foundational Principle

- **Stakeholder Authority** — The agent NEVER changes priorities, scope, or closes issues on its own — if it has concerns, it escalates and waits.

## Repo Structure

<!-- Customize for your project -->
- `src/` — source code
- `tests/` — test suite
- `docs/` — documentation
- `scripts/` — utility scripts

## Key Commands

<!-- Customize for your project -->
```bash
# Run tests
pytest tests/ -v

# Lint and format
ruff check src/ && ruff format src/

# Type check
mypy src/
```

## Coding Conventions

<!-- Customize for your language/framework -->
- Use type hints where they improve clarity
- Keep code readable; avoid clever one-liners
- Preserve existing public APIs unless explicitly asked
- When changing logic, update or add tests

## Architectural Decisions

See `docs/architecture/ADR.md` for immutable architectural decisions.

## Safety

- Don't delete or overwrite output artifacts unless explicitly asked
- Don't edit `.env` or `.db` files directly
- Don't modify ADRs without explicit confirmation

## Available Agents

| Agent | Invoke With | Use For |
|-------|------------|---------|
| Code Developer | `@code-developer` | Write/improve code, refactoring |
| Test Engineer | `@test-engineer` | Write tests, coverage analysis |
| Documentation | `@documentation-agent` | Technical docs, README |
| Security Reviewer | `@security-reviewer` | Security audit, credential scan |
| Research Agent | `@research-agent` | Research topics, propose solutions |
| Architect | `@architect` | ADR compliance, system design review |
| Release Agent | `@release-agent` | Versioning, changelogs, release readiness |
| Challenger | `@challenger` | Adversarial review of decisions and sprints |
| CI Fixer | `@ci-fixer` | Diagnose and fix CI/CD failures |
| Copilot Customization Builder | `@copilot-customization-builder` | Create agents, skills, instructions |

## ⛔ Workflow Gates

**⛔ Gate 0: PROCESS OVER SPEED — Every code change requires: feature branch → PR → CI green → merge. No exceptions. Not for "small fixes". Not for "time pressure". Not for "autonomy mode". Direct pushes to main are a process violation, not a shortcut.**

1. **Every Change → Branch + PR**: `git checkout -b feat/<issue>-<name>` → commit → push → `gh pr create` → CI green → squash-merge. Never `git push origin main`. Never `--no-verify`.

### ⛔ Gate 1: CI Gate — Enforcement

**After creating a PR, wait 3-5 minutes for CI to complete before merging.**

```bash
gh run list --branch <branch> --limit 3   # ALL must show ✓
gh run view <run-id> --log-failed          # If any show ✗, diagnose
```

- **Do NOT merge on red. No exceptions.**
- "Tests passed locally" is NOT sufficient — CI must be green.
- Only after CI is green: `gh pr merge <number> --squash --delete-branch`

## Available Skills

| Skill | Use For |
|-------|---------|
| `sprint-planning` | Triage backlog, score ICE, select sprint scope |
| `sprint-start` | Begin sprint execution with quality gates |
| `sprint-review` | Demo deliverables, metrics, acceptance |
| `sprint-retro` | Process improvements, velocity tracking |
| `refine` | Turn `type:idea` issues into concrete backlog items with acceptance criteria |
| `orchestrate-feature` | Full feature pipeline |
| `orchestrate-bugfix` | Full bugfix pipeline |
| `code-review` | Structured code review |
| `create-pr` | Create PR with conventional title |
| `tdd-workflow` | Test-driven development cycle |
| `architecture-review` | Evaluate change for ADR compliance |
| `release-check` | Assess release readiness |
| `direction-gate` | Structured review before strategic pivots |
| `issue-triage` | Triage issues needing attention |
| `new-custom-agent` | Template for creating a new agent |
| `new-prompt-file` | Template for creating a new skill |
| `new-instructions-file` | Template for creating instructions file |
| `subagent-dispatch` | Execute plans with independent subagents |
| `web-research` | Structured web research with citations |
| `writing-plans` | Implementation plans with bite-sized tasks |

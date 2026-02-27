# AI Scrum Sprint Runner — Repository Overview

**Complete guide for new developers and stakeholders**

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture Overview](#architecture-overview)
- [Key Concepts](#key-concepts)
- [Directory Structure](#directory-structure)
- [Configuration](#configuration)
- [Further Reading](#further-reading)

---

## Project Overview

The **AI Scrum Sprint Runner** is an ACP-powered autonomous sprint engine that orchestrates GitHub Copilot CLI via the Agent Client Protocol to run complete Scrum sprints — planning, execution, review, and retrospective — without manual intervention.

**Key insight**: The AI agent acts as **Product Owner + Scrum Master**, while the human maintains **Stakeholder** authority with veto rights. Instead of AI helping humans write code, AI runs the entire sprint workflow while humans provide strategic direction.

**Core capabilities**:
- **Autonomous Execution**: Full sprint lifecycle (refine → plan → execute → review → retro)
- **Parallel Work**: Multiple issues executed simultaneously via git worktrees
- **Quality Enforcement**: Tests, lint, type checks, diff size limits, and challenger reviews
- **Real-time Monitoring**: Web dashboard with live sprint status and ACP session viewer
- **Sprint Discipline**: Drift control, escalation, and process gates prevent scope creep

---

## Architecture Overview

### High-Level Architecture

```
┌──────────────────────────────────────────────────┐
│                 Web Dashboard                     │
│  Sprint Status │ Issue List │ Chat │ Sessions     │
└────────┬───────────────────────────┬──────────────┘
         │ WebSocket                 │ REST API
┌────────┴───────────────────────────┴──────────────┐
│              Dashboard Server                      │
│  Event Bridge │ Issue Cache │ Chat Manager          │
└────────┬───────────────────────────────────────────┘
         │ SprintEventBus
┌────────┴───────────────────────────────────────────┐
│              Sprint Runner (State Machine)          │
│  init → refine → plan → execute → review → retro   │
├─────────────┬──────────────┬───────────────────────┤
│ Ceremonies  │ Enforcement  │ Infrastructure         │
│ · Planning  │ · Quality    │ · ACP Client           │
│ · Execution │ · Drift      │ · Git Worktrees        │
│ · Review    │ · Escalation │ · GitHub API (gh CLI)   │
│ · Retro     │ · Challenger │ · Sprint Docs           │
└─────────────┴──────────────┴───────────────────────┘
         │ ACP (Agent Client Protocol)
┌────────┴───────────────────────────────────────────┐
│          GitHub Copilot CLI (copilot --acp)         │
└────────────────────────────────────────────────────┘
```

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **ACP Client** | `src/acp/` | ACP session management (JSON-RPC, session pooling, permissions) |
| **Ceremonies** | `src/ceremonies/` | Planning (ICE scoring), execution (parallel dispatch), review, retro, refinement |
| **Enforcement** | `src/enforcement/` | Quality gates (tests/lint/types), drift control, escalation, challenger reviews |
| **Git** | `src/git/` | Worktree management, merge handling, diff analysis |
| **GitHub API** | `src/github/` | Issues, labels, milestones via `gh` CLI |
| **Dashboard** | `src/dashboard/` | Web UI with WebSocket updates, REST API, agent chat |
| **Documentation** | `src/documentation/` | Sprint logs, huddle notes, velocity tracking |

### Data Flow

1. **Sprint Start**: Load config, fetch GitHub milestone, create sprint state
2. **Planning**: ACP session analyzes backlog, scores issues (ICE), creates execution groups
3. **Execution**: Parallel dispatcher creates worktrees, spawns ACP sessions per issue
4. **Quality Gates**: Each issue runs tests/lint/types, checks diff size, triggers challenger
5. **Merge**: On pass → squash-merge to main; on fail → revert worktree and escalate
6. **Review/Retro**: Aggregate metrics, generate sprint log, identify improvements

### State Management

Sprint state persists in `docs/sprints/sprint-N-state.json` with phase, issue results, and metrics (velocity, completion rate, drift).

---

## Key Concepts

### Sprint Lifecycle

```
init → refine → plan → execute → review → retro → (next sprint)
```

| Phase | Description |
|-------|-------------|
| **Init** | Load config, fetch milestone, initialize state |
| **Refine** | Convert `type:idea` issues to `status:ready` with acceptance criteria |
| **Plan** | Score issues (ICE), form dependency groups, select sprint backlog |
| **Execute** | Parallel dispatcher creates worktrees, spawns worker agents |
| **Review** | Aggregate metrics, verify deliverables, generate sprint log |
| **Retro** | Analyze velocity, identify improvements, update process |

### ACP (Agent Client Protocol)

JSON-RPC protocol for communicating with GitHub Copilot CLI, enabling programmatic access to AI agents with tool calling (bash, edit, view, grep, etc.).

**Agent roles**: Planner (analyzes backlog, Opus model) · Worker (implements issues, Sonnet model) · Reviewer (checks quality, Opus model) · Challenger (adversarial review)

### Git Worktrees

Separate working directories sharing the same `.git` folder enable true parallel execution of 4+ issues simultaneously. Each issue gets its own worktree, ACP session, and branch — no stashing or branch switching needed.

### Quality Gates

Run before every merge: tests, lint, type checks, diff size ≤ 300 lines, and CI green. **Drift control** tracks expected file modifications per issue and escalates to the stakeholder after 2 drift incidents.

### Challenger Pattern

Adversarial review agent that runs at end of sprint planning and review. Challenges assumptions, finds missed edge cases, questions whether acceptance criteria are met. Output goes to the stakeholder for final decisions.

### Test Isolation

The `sprint.prefix` config field controls naming for milestones, branches, and state files. Use `"Test Sprint"` for isolated testing separate from production `"Sprint"` data.

---

## Directory Structure

```
src/
├── index.ts              # CLI entry point (Commander.js)
├── config.ts             # Zod-validated YAML config loader
├── runner.ts             # Sprint lifecycle state machine
├── types.ts              # Shared TypeScript interfaces
├── acp/                  # ACP client, session pool, permissions
├── ceremonies/           # Planning, execution, review, retro, refinement
├── enforcement/          # Quality gates, drift control, escalation, challenger
├── git/                  # Worktree management, merge, diff analysis
├── github/               # Issues, labels, milestones via gh CLI
├── dashboard/            # Web UI (HTTP + WebSocket + REST API + static files)
├── documentation/        # Sprint logs, huddles, velocity
├── tui/                  # Terminal UI (Ink/React)
└── improvement/          # Retrospective action tracking

tests/                    # Vitest test suite (unit, integration, fixtures)
scripts/                  # Utility scripts (test setup/cleanup, notifications)
prompts/                  # ACP prompt templates (planner, worker, reviewer, challenger)
docs/                     # Constitution, architecture (ADRs), sprint state/logs
```

---

## Configuration

Configuration lives in `sprint-runner.config.yaml` (Zod-validated). Key fields:

| Field | Purpose | Default |
|-------|---------|---------|
| `sprint.prefix` | Milestone/branch naming (`"Sprint"` or `"Test Sprint"`) | `"Sprint"` |
| `copilot.max_parallel_sessions` | Concurrent ACP sessions | `4` |
| `copilot.phases` | Model assignment per role (planner/worker/reviewer) | Opus/Sonnet |
| `quality_gates.max_diff_lines` | Max diff size per PR | `300` |
| `git.auto_merge` | Auto-merge on CI green | `true` |

For full configuration examples and setup instructions, see **[README.md](../README.md)**.

---

## Further Reading

- **[README.md](../README.md)** — Quick start, installation, CLI commands, and configuration
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — Development setup, workflow, conventions, and code style
- **[CHANGELOG.md](../CHANGELOG.md)** — Version history and release notes
- **[docs/constitution/PHILOSOPHY.md](constitution/PHILOSOPHY.md)** — Project values and principles
- **[docs/constitution/PROCESS.md](constitution/PROCESS.md)** — Development process constitution
- **[docs/architecture/ADR.md](architecture/ADR.md)** — Architectural Decision Records

**External**: [ACP Docs](https://docs.github.com/en/copilot) · [Conventional Commits](https://www.conventionalcommits.org/) · [Git Worktrees](https://git-scm.com/docs/git-worktree) · [Scrum Guide](https://scrumguides.org/)

# AI Scrum Sprint Runner — Project Overview

> ACP-powered autonomous sprint engine that orchestrates GitHub Copilot CLI to run full Scrum sprints.

## What Is This?

The AI Scrum Sprint Runner is a TypeScript CLI tool that automates the Scrum process end-to-end. It uses the **Agent Client Protocol (ACP)** to programmatically drive GitHub Copilot CLI sessions, executing sprint ceremonies — from refinement and planning through execution, review, and retrospective.

### Role Model

| Role | Actor |
|------|-------|
| **Product Owner + Scrum Master** | AI Agent (Sprint Runner) |
| **Stakeholder** | Human operator |

The human sets priorities and approves direction. The AI handles everything else: backlog refinement, sprint planning, issue execution (branching, coding, testing, PRs), quality enforcement, and documentation.

## Architecture Overview

The system is organized into focused modules under `src/`:

| Module | Responsibility |
|--------|----------------|
| `acp/` | ACP client, session pool, permission management |
| `ceremonies/` | Sprint ceremonies — refinement, planning, execution, review, retro |
| `enforcement/` | Quality gates, drift control, escalation, challenger review |
| `git/` | Worktree management, merge operations, diff analysis |
| `github/` | Issues, labels, milestones via `gh` CLI |
| `documentation/` | Sprint logs, huddle notes, velocity tracking |
| `dashboard/` | Web dashboard (HTTP server + WebSocket) |
| `tui/` | Terminal UI dashboard and event bus |
| `improvement/` | Continuous improvement and process adaptation |

### Core Flow

```
Config (YAML + Zod) → Sprint Runner → Ceremonies Pipeline → ACP Sessions → Copilot CLI
                                          ↓
                              Enforcement (quality gates, drift control)
                                          ↓
                              Documentation (sprint logs, metrics)
```

## Setup Guide

### Prerequisites

- **Node.js** ≥ 20.0.0
- **GitHub CLI** (`gh`) — authenticated
- **GitHub Copilot CLI** — installed and configured
- **Git** — for worktree and branch management

### Install

```bash
git clone <repo-url> && cd ai-scrum-autonomous-v2
npm install
npm run build
```

### Configuration

The runner is configured via `sprint-runner.config.yaml` (validated with Zod at load time). A test configuration is available at `sprint-runner.test.yaml`.

Key config sections:
- **Repository** — owner, repo name, default branch
- **ACP** — server connections (stdio/HTTP), MCP servers
- **Sprint** — sprint length, velocity, planning parameters
- **Quality gates** — lint, typecheck, test thresholds

## CLI Commands

```bash
sprint-runner plan --sprint <N>                       # Sprint planning
sprint-runner execute-issue --issue <N> --sprint <N>  # Execute single issue
sprint-runner full-cycle --sprint <N>                 # Complete sprint cycle
sprint-runner refine / review / retro --sprint <N>    # Individual ceremonies
sprint-runner check-quality --branch <name>           # Quality gates
sprint-runner status                                  # Current sprint status
sprint-runner metrics / drift-report --sprint <N>     # Metrics & drift
sprint-runner pause / resume                          # Pause/resume
```

Dev mode: `npx tsx src/index.ts <command>`

## Developer Workflow

Every change follows: feature branch → PR → CI green → squash-merge. No exceptions.

```bash
git checkout -b feat/<issue>-<name>    # Branch
npx vitest run && npx eslint src/ tests/ && npx tsc --noEmit  # Verify locally
gh pr create                           # PR → CI → merge
```

### Quality Gates

- **Lint** — ESLint with TypeScript rules
- **Type check** — `tsc --noEmit` (strict mode)
- **Tests** — Vitest (unit + integration)
- **Drift control** — Detects unplanned scope additions

```bash
npm run check          # All-in-one: lint + typecheck + tests
npm run build          # Compile TypeScript
make help              # Show all Makefile shortcuts
```

## Directory Structure

```
src/                   TypeScript source code
├── acp/               ACP client and session management
├── ceremonies/        Sprint ceremony implementations
├── enforcement/       Quality gates and drift control
├── git/               Git operations (worktree, merge, diff)
├── github/            GitHub API via gh CLI
├── documentation/     Sprint logs and velocity tracking
├── dashboard/         Web dashboard (HTTP + WebSocket)
├── tui/               Terminal UI and event bus
├── improvement/       Process improvement logic
├── config.ts          YAML config loader with Zod validation
├── runner.ts          Main sprint runner orchestrator
├── logger.ts          Structured logging (pino)
├── metrics.ts         Sprint metrics collection
├── types.ts           Shared type definitions
└── index.ts           CLI entry point (Commander.js)
tests/                 Test suite (mirrors src/ structure)
prompts/               Prompt templates for ACP sessions
docs/                  Documentation, constitution, architecture
scripts/               Utility and notification scripts
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript (ESM, `"module": "NodeNext"`) |
| Runtime | Node.js ≥ 20 |
| ACP SDK | `@agentclientprotocol/sdk` |
| CLI | Commander.js |
| Validation | Zod |
| Logging | pino |
| Testing | Vitest |
| E2E Testing | Playwright |
| Dashboard | Ink (TUI), WebSocket (web) |
| Linting | ESLint + Prettier |
## Further Reading

- [`docs/constitution/PROCESS.md`](constitution/PROCESS.md) — Development process, DoD, ceremonies
- [`docs/constitution/PHILOSOPHY.md`](constitution/PHILOSOPHY.md) — Values and principles
- [`docs/architecture/ADR.md`](architecture/ADR.md) — Architectural Decision Records
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — Contribution guidelines
- [`CHANGELOG.md`](../CHANGELOG.md) — Release history

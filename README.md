# Copilot Scrum Autonomous

[![Optimized for GitHub Copilot CLI](https://img.shields.io/badge/Optimized%20for-GitHub%20Copilot%20CLI-blue?logo=github)](https://docs.github.com/en/copilot)
[![Framework Docs](https://img.shields.io/badge/Framework-AI--Scrum-6c63ff)](https://trsdn.github.io/ai-scrum/)

A template repository for **autonomous Scrum development** powered by GitHub Copilot CLI. The AI agent acts as both **Product Owner and Scrum Master**, while the human serves as a **Stakeholder** with veto rights.

> **This is the AUTONOMOUS variant.** For the PO-driven variant where the human drives each sprint phase manually, see [copilot-scrum-guided](https://github.com/trsdn/copilot-scrum-guided).
>
> 📖 **[Read the full framework documentation →](https://trsdn.github.io/ai-scrum/)**

---

## What This Is

A production-tested methodology for running full Scrum sprints with GitHub Copilot CLI as the autonomous driver. The agent plans sprints, executes issues, reviews deliverables, and runs retrospectives — only escalating to the human for strategic decisions.

This template is **domain-agnostic**. It was extracted from a real production workflow and works for any software project using GitHub Copilot CLI.

## The Operating Model

| Role | Who | Responsibility |
|------|-----|----------------|
| **Stakeholder** | Human | Strategic direction, veto right, escalation decisions |
| **PO + Scrum Master** | Copilot Agent | Backlog management, sprint execution, quality gates, ceremonies |

The agent operates autonomously through full sprint cycles. The stakeholder is only involved when escalation criteria are met.

### Escalation Model

| Level | When | Examples |
|-------|------|----------|
| ⛔ **MUST Escalate** | Strategic, ADR, constitution, dependencies, production, spending | "Should we add a new framework?" |
| ⚠️ **SHOULD Escalate** | Scope > 8, deprioritize high, big refactor, close >5 stale | "Planning 9 issues, OK?" |
| ✅ **Autonomous** | Everything else | Sprint planning, code, tests, config, docs, CI |

## Sprint Cycle

```
Planning → Start → [Execute with Huddles] → Review → Retro → repeat
```

| Phase | Slash Command | What Happens |
|-------|---------------|--------------|
| **Planning** | `/sprint-planning` | Triage backlog, ICE score, select scope, assign labels + milestone |
| **Start** | `/sprint-start` | Create sprint log, begin execution (no consent gate) |
| **Execute** | *(automatic)* | Issue by issue with quality gates and huddles |
| **Review** | `/sprint-review` | Gather evidence, delivery report, notify stakeholder |
| **Retro** | `/sprint-retro` | What went well/badly, velocity, process improvements |

Sprints flow automatically — planning leads directly into execution without manual intervention.

## Key Features

- **ICE Scoring** — Impact × Confidence / Effort for prioritization
- **Quality Gates** — Test gate (≥3 tests/feature), CI gate, Definition of Done
- **Agent Dispatch** — Specialized agents for code/tests/review, lightweight agents for commands/search
- **Daily Huddles** — Documented on issues + sprint log after each task
- **Verification Before Completion** — "Evidence before claims, always"
- **Notifications** — Push notifications via [ntfy.sh](https://ntfy.sh)
- **Velocity Tracking** — Sprint-over-sprint performance data

## Prerequisites

- **GitHub Copilot subscription** (Pro, Pro+, Business, or Enterprise) — [plans](https://github.com/features/copilot/plans)
- **Copilot CLI** installed — [installation guide](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- **Experimental mode enabled** — Autopilot mode is experimental and must be activated:
  ```bash
  copilot --experimental    # Enable on first launch (persisted in config)
  ```
  Once inside a session, press `Shift+Tab` to cycle to **Autopilot mode** — this lets the agent continue working until a task is complete, which is essential for autonomous sprints.

## Getting Started

### 1. Use as Template

Click **"Use this template"** on GitHub, or:

```bash
gh repo create my-project --template trsdn/copilot-scrum-autonomous --clone
cd my-project
```

### 2. Customize for Your Project

| File | What to Change |
|------|----------------|
| `AGENTS.md` | Replace `{{PROJECT_NAME}}` and `{{PROJECT_DESCRIPTION}}` placeholders |
| `AGENTS.md` | Add your project-specific commands, coding conventions, key files |
| `docs/architecture/ADR.md` | Add your architectural decisions |
| `.github/agents/*.agent.md` | Customize agent expertise for your domain |
| `.github/copilot-instructions.md` | Adjust Copilot behavior and conventions |
| `Makefile` | Add project-specific targets |
| `pyproject.toml` | Configure your project metadata |
| `.github/workflows/ci.yml` | Adjust CI for your language/framework |

### 3. Set Up Notifications (Optional)

```bash
# Install ntfy on your phone (iOS/Android)
# Subscribe to a secret topic

echo 'export NTFY_TOPIC="your-secret-topic"' >> ~/.zshrc
source ~/.zshrc

# Test
curl -d "Hello from Copilot!" ntfy.sh/$NTFY_TOPIC
```

### 4. Start Your First Sprint

```bash
# Open GitHub Copilot CLI in your project
copilot

# Run sprint planning
/sprint-planning

# Execution starts automatically after planning
```

## How It Works

### The Sprint Cycle in Detail

1. **Planning** (`/sprint-planning`)
   - Reviews open issues and their status labels
   - Triages unlabeled issues with ICE scoring
   - Elaborates top issues with acceptance criteria
   - Selects sprint scope (~7 issues based on velocity)
   - Assigns `status:planned` label and sprint milestone
   - Proceeds directly to execution

2. **Execution** (automatic)
   - Works through issues one at a time
   - Creates worktree per issue, implements, tests, PRs
   - Runs daily huddle after each issue (documented on issue + sprint log)
   - Quality gates: tests (≥3/feature), CI green, Definition of Done

3. **Review** (`/sprint-review`)
   - Gathers evidence (commits, PRs, closed issues)
   - Creates delivery report with metrics
   - Accepts deliverables autonomously (unless MUST criteria met)
   - Sends sprint summary notification

4. **Retro** (`/sprint-retro`)
   - What went well / what didn't
   - Key learnings and action items
   - Velocity tracking update
   - **Process & tooling improvements** (mandatory Step 8)

### Agent Dispatch

| Task | Agent | Use Case |
|------|-------|----------|
| Code changes | `@code-developer` | Multi-file reasoning, refactoring |
| Writing tests | `@test-engineer` | Behavior understanding, TDD |
| Code review | `@code-review` | Structured review with checklists |
| Research/docs | `@research-agent` / `@documentation-agent` | Synthesis, technical writing |
| Decision review | `@challenger` | Adversarial review of decisions and sprints |
| CI failures | `@ci-fixer` | Diagnose and fix CI/CD failures |

## Sprint Documentation & Artifacts

Every sprint produces structured documentation that creates an audit trail and preserves knowledge across sessions.

### Where Things Are Stored

| Artifact | Location | Created By | Purpose |
|----------|----------|------------|---------|
| Sprint log | `docs/sprints/sprint-N-log.md` | Sprint Start | Huddle decisions, learnings, plan changes during execution |
| Velocity data | `docs/sprints/velocity.md` | Sprint Retro | Sprint-over-sprint performance tracking |
| Issue comments | GitHub Issues | Huddles | Traceable audit trail per issue |
| Implementation plans | `docs/plans/` | Planning / Writing Plans | Detailed implementation specs |
| ADRs | `docs/architecture/ADR.md` | As needed | Immutable architectural decisions |
| Process rules | `docs/constitution/PROCESS.md` | Sprint Retro | Evolving process constitution |

### The Huddle Documentation Rule

After each issue is completed, a **daily huddle** is performed and documented in **two places**:

1. **Comment on the completed GitHub issue** — creates a traceable, permanent record:
   ```bash
   gh issue comment 42 --body "### Huddle — Sprint 5, Issue 3/7 done
   **Outcome**: Implemented rate limiter with token bucket, 95% test coverage
   **Key learning**: Redis connection pooling needed for production scale
   **Decision**: Re-prioritize #45 above #43 based on this finding
   **Next**: #45 — Connection pool configuration"
   ```

2. **Append to sprint log** (`docs/sprints/sprint-N-log.md`) — preserves context for retros:
   ```markdown
   ### Huddle — After Issue #42 (2025-01-15 14:30)
   **Completed**: #42 — Rate limiter implemented
   **Sprint progress**: 3/7 issues done
   **Key learning**: Redis pooling impacts performance at scale
   **Plan check**: Reordered — #45 now before #43
   **Next up**: #45 — Connection pool configuration
   ```

### Sprint Log Template

Created automatically at sprint start (`docs/sprints/sprint-N-log.md`):

```markdown
# Sprint N Log — [Date]

**Goal**: [One-sentence sprint goal]
**Planned**: [N] issues

## Huddles
[Appended after each issue completes]
```

### Velocity Tracking

Updated each sprint retro in `docs/sprints/velocity.md`:

```markdown
| Sprint | Date | Goal | Planned | Done | Carry | ~Hours | Issues/Hr | Notes |
|--------|------|------|---------|------|-------|--------|-----------|-------|
| 1      | ...  | ...  | 7       | 7    | 0     | 3.0    | 2.3       | First sprint |
| 2      | ...  | ...  | 7       | 5    | 2     | 3.5    | 1.4       | Integration heavy |
```

This data drives sprint sizing — the agent uses historical velocity to determine how many issues to plan.

## Directory Structure

```
├── AGENTS.md                        # Project-specific agent instructions
├── .github/
│   ├── copilot-instructions.md      # Main Copilot instructions
│   ├── agents/                      # Specialized agent definitions
│   │   ├── architect.agent.md
│   │   ├── challenger.agent.md
│   │   ├── ci-fixer.agent.md
│   │   ├── code-developer.agent.md
│   │   ├── copilot-customization-builder.agent.md
│   │   ├── documentation-agent.agent.md
│   │   ├── release-agent.agent.md
│   │   ├── research-agent.agent.md
│   │   ├── security-reviewer.agent.md
│   │   └── test-engineer.agent.md
│   ├── skills/                      # Reusable workflow skills
│   │   ├── architecture-review/SKILL.md
│   │   ├── code-review/SKILL.md
│   │   ├── create-pr/SKILL.md
│   │   ├── direction-gate/SKILL.md
│   │   ├── issue-triage/SKILL.md
│   │   ├── new-custom-agent/SKILL.md
│   │   ├── new-instructions-file/SKILL.md
│   │   ├── new-prompt-file/SKILL.md
│   │   ├── orchestrate-bugfix/SKILL.md
│   │   ├── orchestrate-feature/SKILL.md
│   │   ├── refine/SKILL.md
│   │   ├── release-check/SKILL.md
│   │   ├── sprint-planning/SKILL.md
│   │   ├── sprint-retro/SKILL.md
│   │   ├── sprint-review/SKILL.md
│   │   ├── sprint-start/SKILL.md
│   │   ├── subagent-dispatch/SKILL.md
│   │   ├── tdd-workflow/SKILL.md
│   │   ├── web-research/SKILL.md
│   │   └── writing-plans/SKILL.md
│   ├── workflows/
│   │   ├── ci.yml                   # CI: lint, typecheck, test, security
│   │   └── release.yml              # Semantic release
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── config.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   ├── constitution/
│   │   ├── PROCESS.md               # Development process constitution
│   │   └── PHILOSOPHY.md            # Project philosophy and principles
│   ├── architecture/
│   │   └── ADR.md                   # Architectural Decision Records
│   ├── research/
│   │   └── JOURNAL.md               # Research findings journal
│   ├── sprints/
│   │   ├── velocity.md              # Sprint velocity tracking
│   │   └── SPRINT-LOG-TEMPLATE.md   # Template for sprint logs
│   └── plans/
│       └── .gitkeep
├── scripts/copilot-notify.sh        # Push notification script
├── Makefile                          # Common development targets
├── pyproject.toml                    # Python project configuration
└── .gitignore
```

## Customization Guide

### Adding Agents

Create `.github/agents/your-agent.agent.md`:

```markdown
# Agent: Your Domain Expert

## Role
[What this agent specializes in]

## Capabilities
- [Capability 1]
- [Capability 2]

## Tools
- [Available tools]

## Guidelines
- [Domain-specific rules]
```

Agents in `.github/agents/` are automatically discovered by GitHub Copilot CLI.

### Adding Skills

Create `.github/skills/your-skill/SKILL.md`:

```markdown
---
name: your-skill
description: "Short description of when to use this skill. Triggers on: 'keyword1', 'keyword2'."
---

# Your Workflow Skill

## Steps

1. [Step 1]
2. [Step 2]
3. [Step 3]
```

Skills in `.github/skills/` are available in both GitHub Copilot CLI and VS Code Insiders.

### Language Adaptation

This template defaults to Python tooling. To adapt for other languages:

1. Update `Makefile` targets with your build/test/lint commands
2. Update `.github/copilot-instructions.md` for your language conventions
3. Update `.github/workflows/ci.yml` for your CI pipeline
4. Adjust coding conventions in `AGENTS.md`
5. Update TDD skill templates for your test framework

### Customization Reference

| What | Where | Purpose |
|------|-------|---------|
| Project-specific instructions | `AGENTS.md` | Commands, conventions, repo structure |
| Copilot behavior & process | `.github/copilot-instructions.md` | Sprint process, escalation, DoD |
| Specialized agents | `.github/agents/*.agent.md` | Domain-specific agent roles |
| Workflow skills | `.github/skills/*/SKILL.md` | Reusable workflow skills |
| CI pipeline | `.github/workflows/ci.yml` | Build, test, lint automation |

## Philosophy

> **The AI-Scrum Manifesto** — see [`docs/constitution/PHILOSOPHY.md`](docs/constitution/PHILOSOPHY.md)

*We have come to value:*
- **Autonomous execution** over constant approval
- **Verified evidence** over claimed completion
- **Sprint discipline** over feature chasing
- **Continuous process improvement** over static workflows

*Inspired by the [Agile Manifesto](https://agilemanifesto.org), adapted for human-AI collaboration.*

<details>
<summary><strong>How the Agile Manifesto maps to AI-Scrum</strong></summary>

#### Values

| Agile Manifesto (2001) | AI-Scrum (2025) | Why It Changed |
|------------------------|-----------------|----------------|
| Individuals and interactions over processes | Autonomous execution over constant approval | The agent *is* the process — it needs clear rails, not watercooler chats |
| Working software over documentation | Verified evidence over claimed completion | The agent will *say* it works — make it *prove* it works |
| Customer collaboration over contracts | Clear escalation over open-ended discussion | The human can't be in every loop — define when to interrupt |
| Responding to change over following a plan | Sprint discipline over feature chasing | The agent *loves* to chase — it needs focus constraints |

#### The 12 Principles

| Agile Principle | AI-Scrum Equivalent |
|----------------|-------------------|
| Satisfy customer through early, continuous delivery | Small, tested diffs — one feature per PR |
| Welcome changing requirements | Welcome scope changes — route through backlog |
| Deliver working software frequently | Sprint cycles with CI verification |
| Business people and developers work together daily | Human brings judgment; agent brings throughput |
| Build around motivated individuals, trust them | The agent is not a junior dev — give it constraints, not motivation |
| Face-to-face conversation | Huddles documented in two places (issue + sprint log) |
| Working software is primary measure of progress | Evidence before assertions, always |
| Sustainable development, constant pace | Velocity is descriptive, not prescriptive |
| Continuous attention to technical excellence | Quality gates are non-negotiable |
| Simplicity — maximize work not done | Prefer config over code, existing over new |
| Best architectures emerge from self-organizing teams | Best architecture emerges from small, tested diffs |
| Regularly reflect and adjust | Process improvements compound |

</details>

> **Focus, Quality, Incremental, Improve** — in that order.

1. **Protect Focus** — Complete what you start before moving on
2. **Quality Gates** — Every change is tested, reviewed, and verified
3. **Small, Testable Diffs** — One feature per PR (~150 lines ideal)
4. **Continuous Improvement** — Every retro produces actionable improvements

## Process Deep Dive

The development process is defined in [`docs/constitution/PROCESS.md`](docs/constitution/PROCESS.md). Below is additional context, rationale, and learnings for human readers.

<details>
<summary><strong>Why Each Principle Matters</strong></summary>

#### 1. Protect Focus

- Context switching wastes 15-30min per switch
- Unfinished work creates technical debt and stale branches
- Sprint carry-over demoralizes and inflates future estimates

#### 2. Quality Gates

- Merge-before-CI-green creates broken main branches
- Coverage gates catch untested code paths
- Strict schema validation catches real configuration bugs

#### 3. Small, Testable Diffs

- Small PRs pass CI faster and are easier to review
- Bundling module + integration causes carry-over
- Standalone units are easier to test and reason about

#### 4. Continuous Improvement

- Process improvements compound — each retro makes the next sprint smoother
- Agent/skill creation eliminates recurring manual work
- Root cause fixes prevent the same failures from recurring

</details>

<details>
<summary><strong>Validated Pattern — Standalone-First Development</strong></summary>

The most productive pattern for new modules:

1. Build module as standalone unit (config + function/class)
2. Write comprehensive tests (15-20 per module)
3. Merge standalone module
4. Wire into system in a separate PR with integration tests

</details>

<details>
<summary><strong>Retro Review Questions</strong></summary>

Ask these at every sprint retrospective:

1. Did we manually do work that an agent should handle?
2. Did any sub-agent fail or produce wrong output?
3. Did we repeat a workflow that should be automated?
4. Did any ceremony take too long or miss important steps?
5. Were issues stuck with stale status labels?

</details>

<details>
<summary><strong>Sprint Sizing — Velocity Data</strong></summary>

Based on observed velocity across sprint types:

| Sprint Type | Recommended Size | Velocity |
|-------------|-----------------|----------|
| Module-building | 7 issues | ~2.3 issues/hr |
| Integration work | 5-6 issues | ~1.0-2.0 issues/hr |
| Research | 7 issues | ~1.4-3.0 issues/hr |
| Mixed | 7 issues | ~2.0 issues/hr |

This data drives sprint sizing — the agent uses historical velocity to determine how many issues to plan.

</details>

<details>
<summary><strong>Key Learnings</strong></summary>

Codified learnings from sprint retrospectives:

1. **Standalone-first, wire-later** is the most productive pattern for new modules
2. **Coverage gates catch real bugs** — don't skip or disable them
3. **Config-driven changes are faster** than code changes
4. **Process improvements compound** — each retro makes the next sprint smoother
5. **Stakeholder corrections are valuable** — listen when scope/framing is corrected

</details>

## License

MIT

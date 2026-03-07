# Example Configurations

Ready-to-use `.aiscrum/` configurations for different project types. Copy one into your project root to get started.

## Quick Start

```bash
# 1. Copy the example that matches your stack
cp -r examples/typescript/.aiscrum .aiscrum

# 2. Edit the config
$EDITOR .aiscrum/config.yaml

# 3. Launch the dashboard
npx tsx src/index.ts web
```

## Available Examples

| Example | Stack | Quality Gates | Notes |
|---------|-------|--------------|-------|
| [`typescript/`](typescript/) | TypeScript + Node.js | vitest, eslint, tsc, tsc build | Default — matches this repo |
| [`python/`](python/) | Python 3.11+ | pytest, ruff, mypy | Uses ruff for fast lint + format |
| [`react/`](react/) | React + Vite + TypeScript | vitest, eslint, tsc, vite build | Includes Playwright e2e gate |
| [`go/`](go/) | Go 1.21+ | go test, golangci-lint, go vet, go build | Uses golangci-lint for comprehensive checks |

## What's Inside Each Example

```
.aiscrum/
├── config.yaml              # Main config — models, gates, git strategy
└── roles/
    ├── general/
    │   └── copilot-instructions.md    # General-purpose agent
    ├── planner/
    │   └── copilot-instructions.md    # Sprint planning agent
    ├── refiner/
    │   └── copilot-instructions.md    # Idea → issue refinement agent
    ├── reviewer/
    │   └── copilot-instructions.md    # Code review agent
    ├── test-engineer/
    │   └── copilot-instructions.md    # TDD agent
    └── retro/
        └── copilot-instructions.md    # Retrospective agent
```

## Customization

### Models

Each sprint phase can use a different model. Use stronger models for planning/review, faster models for workers:

```yaml
copilot:
  phases:
    planner:  { model: "claude-opus-4.6" }     # Best reasoning for planning
    worker:   { model: "claude-sonnet-4.5" }    # Good balance for coding
    reviewer: { model: "claude-opus-4.6" }      # Thorough review
```

### Quality Gates

Disable gates you don't need:

```yaml
quality_gates:
  require_tests: true       # Must have tests
  require_lint: true        # Must pass linter
  require_types: false      # Skip if no type system (plain JS, Python without mypy)
  require_build: false      # Skip if interpreted language
```

### Sprint Size

Control how much work enters each sprint:

```yaml
sprint:
  min_issues: 2             # Don't start with fewer than 2
  max_issues: 6             # Cap at 6 per sprint
  max_drift_incidents: 2    # Escalate if >2 unplanned issues
```

### Notifications

Get push notifications via [ntfy.sh](https://ntfy.sh):

```yaml
escalation:
  notifications:
    ntfy: true
    ntfy_topic: "my-project-sprints"    # Or use ${NTFY_TOPIC} env var
```

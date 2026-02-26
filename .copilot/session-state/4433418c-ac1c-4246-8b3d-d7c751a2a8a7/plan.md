# Plan: TUI Daemon with Ink for Sprint Runner

## Problem

The sprint runner has no oversight UI. You start a command, it runs to completion with log output, and you can't see what's happening or intervene. The `status`, `pause`, `resume` CLI commands are stubs.

## Approach

Build a **local daemon** with an **Ink-based TUI** (React for the terminal) that:
- Shows a live dashboard of the current sprint
- Streams ACP worker output in real-time
- Accepts keyboard commands to pause/resume/skip/prioritize
- Runs the sprint loop continuously until stopped

### Architecture

```
TUI (Ink + React)
├── SprintDashboard (issues + status)
├── WorkerPanel (live ACP output)
├── LogPanel (event history)
└── CommandBar (keyboard input)
       │ subscribes to events
       ▼
SprintEngine (EventEmitter)
├── issue:start / issue:done / issue:fail
├── phase:change (refine→plan→execute...)
├── worker:output (streaming ACP text)
├── sprint:complete / sprint:error
└── state changes → persist to JSON
       │ drives
       ▼
Existing modules (SprintRunner + AcpClient + ceremonies)
```

### Keyboard Controls

| Key | Action |
|-----|--------|
| p | Pause (finish current, then stop) |
| r | Resume |
| s | Skip current issue |
| q | Graceful quit |
| ↑/↓ | Scroll issue list |
| Tab | Switch panel focus |

## Todos

### Phase 1: Engine Events
- [ ] **install-ink** — Install ink, react, @types/react; configure JSX in tsconfig
- [ ] **sprint-engine-events** — Add EventEmitter to SprintRunner with typed events (issue:start, issue:done, issue:fail, phase:change, worker:output, sprint:complete)
- [ ] **acp-streaming** — Wire ACP session notifications (agent_message_chunk) to worker:output events

### Phase 2: TUI Components
- [ ] **tui-app** — Main Ink App component with layout (Header + IssueList + WorkerPanel + LogPanel + CommandBar)
- [ ] **tui-header** — Header: sprint number, phase, progress bar
- [ ] **tui-issue-list** — Issue list with status icons (●/✓/○/⊘)
- [ ] **tui-worker-panel** — Live streaming ACP output
- [ ] **tui-log-panel** — Timestamped event log (last 20 entries)
- [ ] **tui-command-bar** — Keyboard handler (p/r/s/q)

### Phase 3: CLI Integration
- [ ] **cli-dashboard-cmd** — New `sprint-runner dashboard --sprint N` command
- [ ] **wire-pause-resume** — Connect TUI controls to SprintRunner.pause()/resume()

### Phase 4: CI/CD
- [ ] **ci-cd-agent** — Replace challenger: monitor PR checks, auto-merge, report deploy status

### Phase 5: Tests
- [ ] **test-engine-events** — Tests for event emission
- [ ] **test-tui-components** — Ink component rendering tests

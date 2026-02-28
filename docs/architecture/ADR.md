# Architectural Decision Records

## How to Add ADRs

When making a significant architectural decision, document it here using this format:

```markdown
## ADR-NNN: [Title]

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-NNN
**Date**: YYYY-MM-DD

### Context

[Why this decision needs to be made. What problem are we solving?]

### Decision

[What we decided to do.]

### Consequences

**Positive:**
- [Benefit 1]
- [Benefit 2]

**Negative:**
- [Trade-off 1]
- [Trade-off 2]

**Risks:**
- [Risk 1]
```

### Rules

- ADRs are **append-only** — never delete, only supersede
- Changing an ADR requires **stakeholder approval** (MUST escalate)
- Number sequentially: ADR-001, ADR-002, etc.
- Keep decisions atomic — one decision per ADR

---

## ADR-001: Example Decision — Use GitHub Issues as Sole Task System

**Status**: Accepted
**Date**: {{DATE}}

### Context

The project needs a single source of truth for task tracking. Using multiple systems (internal todo lists, chat history, external tools) creates fragmentation and lost context.

### Decision

GitHub Issues is the ONLY task tracking system. All work items, bugs, features, and tasks must be tracked as GitHub Issues. No internal todo lists, chat-based tracking, or external tools.

### Consequences

**Positive:**
- Single source of truth for all work
- Traceable audit trail via issue comments
- Integration with PRs, commits, and CI
- Labels + milestones provide visual workflow

**Negative:**
- Requires discipline to always create issues
- Minor overhead for trivial tasks
- Dependent on GitHub availability

**Risks:**
- Team members may forget to create issues for discovered work

---

## ADR-002: Stdio-based ACP Client over HTTP/SSE

**Status**: Accepted
**Date**: 2026-02-28

### Context

The ACP client needs to communicate with Copilot CLI. Three transport options exist: stdio (subprocess), HTTP, and SSE. The choice affects lifecycle control, deployment complexity, and debugging.

### Decision

Use stdio transport — spawn Copilot CLI as a subprocess with stdin/stdout pipes, converting Node streams to Web ReadableStream/WritableStream for the ndJSON protocol.

### Consequences

**Positive:**
- Tight lifecycle control — process starts and stops with the runner
- No network configuration or port management required
- Simple deployment — just the Copilot CLI binary

**Negative:**
- Requires Copilot CLI installed locally (not remote)
- One process per client instance

**Risks:**
- Copilot CLI version changes could break the stdio protocol

---

## ADR-003: Typed EventBus with Discriminated Unions

**Status**: Accepted
**Date**: 2026-02-28

### Context

The system needs an event bus for decoupled communication between ceremonies, the dashboard, and the runner. Events carry different payloads per type, and type safety is important to prevent runtime errors.

### Decision

Use a TypeScript discriminated union (`SprintEngineEvents` interface) mapping event names to payload types, with `emitTyped()` and `onTyped()` methods on a `SprintEventBus` class extending `EventEmitter`.

### Consequences

**Positive:**
- Compile-time type safety for all 15 event types
- IDE autocompletion for event names and payloads
- Impossible to emit wrong payload shape for an event

**Negative:**
- Adding new events requires updating the interface
- Type assertions needed at the EventEmitter boundary

**Risks:**
- Event type explosion if too many events are added

---

## ADR-004: Atomic State Persistence (tmp → fsync → rename)

**Status**: Accepted
**Date**: 2026-02-28

### Context

Sprint state must survive process crashes without corruption. A naive `writeFileSync` can produce partial files if the process crashes mid-write or the OS buffers haven't flushed.

### Decision

Use atomic writes: write to a `.tmp` file, `fsync` to ensure disk flush, then atomically `rename` to the target path. Combined with PID-based file locking for exclusive access.

### Consequences

**Positive:**
- Crash-safe — incomplete writes never appear at the target path
- Lock recovery — stale locks from dead processes are automatically cleaned
- No external dependencies (no database, no Redis)

**Negative:**
- Slightly slower than direct writes due to fsync
- PID-based locking is single-machine only

**Risks:**
- NFS or networked filesystems may not guarantee rename atomicity

---

## ADR-005: Git Worktree-based Parallel Issue Isolation

**Status**: Accepted
**Date**: 2026-02-28

### Context

Multiple issues execute in parallel. Each needs an isolated working directory to avoid conflicts. Options: separate clones, branch switching, or git worktrees.

### Decision

Use git worktrees — each issue gets its own worktree directory with a dedicated branch. Worktrees share the same `.git` repository, avoiding full clone overhead.

### Consequences

**Positive:**
- True parallel execution — no branch switching contention
- Shared git history — no clone overhead
- Clean isolation — each worktree has independent working directory

**Negative:**
- Requires disk space for each worktree
- Cleanup discipline needed (orphaned worktrees waste space)
- Git version ≥2.20 required

**Risks:**
- Worktree bugs in older git versions

---

## ADR-006: Zod Schema Validation for Configuration

**Status**: Accepted
**Date**: 2026-02-28

### Context

Configuration is loaded from YAML files and must be validated at runtime. Options: TypeScript-only types (no runtime validation), JSON Schema, or Zod.

### Decision

Use Zod schemas for all configuration validation. The YAML is parsed and validated through Zod schemas that provide defaults, type coercion, and descriptive error messages.

### Consequences

**Positive:**
- Runtime validation catches config errors at startup, not mid-sprint
- Defaults defined in schemas — missing fields get sensible defaults
- TypeScript types inferred from schemas — single source of truth

**Negative:**
- Schema must stay in sync with documentation
- Zod is a runtime dependency

**Risks:**
- Complex nested schemas can be hard to debug when validation fails

---

## ADR-007: Dependency-Graph-Ordered Parallel Execution

**Status**: Accepted
**Date**: 2026-02-28

### Context

Sprint issues may depend on each other (`depends_on` field) or touch the same files. The execution order must respect dependencies while maximizing parallelism.

### Decision

Use topological sort (longest-path depth computation) to group issues by dependency level. Within each level, split issues with overlapping `expectedFiles` into sequential sub-groups using greedy graph coloring. Execute groups sequentially; issues within a group concurrently via `p-limit`.

### Consequences

**Positive:**
- Dependencies are always respected (level N completes before level N+1)
- Maximum parallelism within each level for non-overlapping issues
- File overlap detection reduces merge conflicts

**Negative:**
- Reduced parallelism for issues with shared files
- `expectedFiles` accuracy depends on planning quality

**Risks:**
- Runtime file conflicts can still occur if `expectedFiles` is incomplete

---

## ADR-008: WebSocket Event Replay on Dashboard Connect

**Status**: Accepted
**Date**: 2026-02-28

### Context

The web dashboard connects via WebSocket to receive real-time sprint events. When a browser reconnects (page refresh, network drop), it misses events that occurred while disconnected.

### Decision

Buffer up to 200 events in a FIFO queue on the server. On new WebSocket connection, replay all buffered events to the client before switching to live mode. Events are marked with `isHistory: true` during replay.

### Consequences

**Positive:**
- Seamless reconnection — no lost events on page refresh
- Client distinguishes historical vs live events for UI rendering
- Fixed memory usage (200 event cap with oldest-first eviction)

**Negative:**
- 200 events may not cover long disconnections
- Replay adds latency on initial connection

**Risks:**
- Large event payloads could increase memory usage

---

## ADR-009: Two-Tier Escalation Model (MUST vs SHOULD)

**Status**: Accepted
**Date**: 2026-02-28

### Context

Automated sprint execution will encounter problems that require human judgment. Not all problems are equally critical — some should pause everything, others are informational.

### Decision

Three escalation levels with different behaviors:
- **MUST**: Creates GitHub issue + pauses the sprint. Requires stakeholder intervention.
- **SHOULD**: Creates GitHub issue + ntfy notification. Sprint continues.
- **INFO**: Creates GitHub issue. Sprint continues.

### Consequences

**Positive:**
- Critical issues guarantee human review
- Non-critical issues don't block sprint progress
- ntfy notifications ensure timely awareness

**Negative:**
- MUST escalations can stall sprints if stakeholder is unavailable
- Level assignment requires judgment

**Risks:**
- Too many SHOULD escalations can cause alert fatigue

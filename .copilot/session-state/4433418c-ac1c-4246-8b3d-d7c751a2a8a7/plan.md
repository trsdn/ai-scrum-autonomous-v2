# Plan: Configurable MCP Servers + Instructions per ACP Session

## Problem

MCP servers and instructions/skills are currently **not wired** to ACP sessions at all:
- `github.mcp_server` is defined in YAML but never passed to `createSession()`
- No way to configure different MCP servers per ceremony phase
- No way to inject custom instructions per phase (only via prompt templates)

## Approach

Two-level configuration: **global** (all sessions) + **per-phase** (ceremony-specific).

### Config YAML Design

```yaml
copilot:
  # Global MCP servers — attached to EVERY ACP session
  mcp_servers:
    - name: "github"
      type: "stdio"
      command: "npx"
      args: ["-y", "@github/mcp-server"]

  # Global instructions — prepended to every prompt
  instructions:
    - ".github/copilot-instructions.md"

  # Per-phase config (model + additional MCPs + additional instructions)
  phases:
    planner:
      model: "claude-opus-4.6"
      mcp_servers: []            # no extra MCPs for planning
      instructions: []           # no extra instructions
    worker:
      model: "claude-sonnet-4.5"
      mcp_servers:               # worker gets filesystem MCP too
        - name: "filesystem"
          type: "stdio"
          command: "npx"
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
      instructions:
        - "prompts/worker-instructions.md"
    reviewer:
      model: "claude-opus-4.6"
      mcp_servers: []
      instructions: []
```

### Merge Logic

When creating a session for phase X:
- `mcpServers = global.mcp_servers + phases.X.mcp_servers`
- `instructions = global.instructions + phases.X.instructions` (loaded from files, prepended to prompt)

### Migration

The old `github.mcp_server` field gets deprecated in favor of `copilot.mcp_servers[]`. For backward compat, if `github.mcp_server` exists and `copilot.mcp_servers` is empty, auto-migrate it.

## Todos

- [ ] **config-schema** — Add `AcpMcpServerSchema`, `PhaseConfigSchema`, update `CopilotSchema` with `mcp_servers`, `instructions`, `phases`
- [ ] **types-update** — Replace `McpServerConfig` with full ACP-compatible `AcpMcpServerEntry`, add `PhaseConfig` and `SessionConfig` to `SprintConfig`
- [ ] **mcp-resolver** — New helper `resolveSessionConfig(config, phase)` that merges global + phase MCPs/instructions and converts to ACP `McpServer[]`
- [ ] **instructions-loader** — New helper `loadInstructions(paths, projectPath)` that reads instruction files and returns concatenated text
- [ ] **wire-execution** — `execution.ts`: pass resolved MCPs to `createSession()`, prepend instructions to prompts
- [ ] **wire-ceremonies** — `planning.ts`, `refinement.ts`, `review.ts`, `retro.ts`, `challenger.ts`, `merge-pipeline.ts`: same wiring
- [ ] **wire-quality-retry** — `handleQualityFailure`: pass MCPs to retry sessions too
- [ ] **backward-compat** — Auto-migrate `github.mcp_server` → `copilot.mcp_servers[0]` in config loader
- [ ] **update-config-yaml** — Move GitHub MCP from `github.mcp_server` to `copilot.mcp_servers`
- [ ] **update-tests** — Update test mocks and add tests for resolver, loader, and config migration
- [ ] **update-session-pool** — Align `SessionPool.CreateSessionOptions.mcpServers` type with ACP `McpServer[]`

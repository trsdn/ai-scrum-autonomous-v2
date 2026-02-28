---
name: copilot-authoring
description: "Reference for creating and maintaining Copilot customization artifacts: agent roles (copilot-instructions.md), skills (SKILL.md), and scoped instructions. Use when scaffolding new agents, adding skills, or modifying agent configurations."
---

# Copilot Authoring Guide

Reference for creating and maintaining agent configuration artifacts in this project.

## Architecture Overview

Agent configurations live in `.aiscrum/roles/<role>/`. Each role is a **self-contained capsule** — the system recursively loads ALL `.md` files from the role folder as the agent's context. No cross-role sharing, no hardcoded prompts.

```
.aiscrum/roles/
├── refiner/
│   ├── copilot-instructions.md    # Agent identity, workflow, rules
│   └── skills/
│       ├── issue-editing/SKILL.md # Specialized capability
│       └── codebase-research/SKILL.md
├── planner/
│   ├── copilot-instructions.md
│   └── skills/
│       └── sprint-planning/SKILL.md
├── reviewer/
│   └── ...
├── retro/
│   └── ...
└── general/
    └── copilot-instructions.md
```

Additionally, `.github/skills/<name>/SKILL.md` holds project-level skills available to the main Copilot CLI session (not loaded into role agents).

## copilot-instructions.md

The core identity file for each role. Defines who the agent is and how it works.

### Structure

```markdown
# {Role Name} Agent — Copilot Instructions

You are a **{Role Name} Agent** for the AI Scrum Sprint Runner project.

## Role

One-sentence description of what this agent does.

## Workflow

1. **Step 1**: What to do first
2. **Step 2**: Next step
3. ...

## Rules

- Hard constraints the agent must follow
- Safety boundaries
- What the agent must NOT do

## Output Format (optional)

- Expected structure of agent responses
```

### Guidelines

- **Be specific**: "Use `gh issue view <number>`" not "check the issue"
- **Include CLI commands**: Agents work via terminal — give exact commands
- **State boundaries**: What the agent must NOT do is as important as what it should
- **Keep it focused**: One role = one responsibility. Avoid multi-purpose agents
- **Stakeholder Authority**: Every role must respect that the user decides scope and priorities

## SKILL.md

Skills are portable, specialized capabilities an agent can use. Each skill lives in its own directory.

### File Format

```markdown
---
name: skill-name
description: "What the skill does and when to use it (max 1024 chars)"
---

# Skill: {Title}

{Brief overview of what this skill accomplishes.}

## When to Use

- Trigger condition 1
- Trigger condition 2

## Instructions

Step-by-step procedures with exact commands.

## Examples

Concrete input/output examples.

## Rules

- Constraints specific to this skill
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase with hyphens, max 64 chars (e.g., `issue-editing`) |
| `description` | Yes | Specific description for relevance matching, max 1024 chars |

### Best Practices

- **One skill = one capability**: `issue-editing` not `github-everything`
- **Effective descriptions**: "Edit GitHub issues via gh CLI — read, update body, manage labels, add comments" not "Help with issues"
- **Include exact commands**: Agents execute in terminal, they need copy-paste-ready commands
- **Add rules**: State what the skill should NOT do (e.g., "Never remove labels without stating why")
- **Reference resources**: Use relative paths for scripts/templates in the skill directory (e.g., `[template](./template.md)`)

### Skill Directory Contents

A skill directory can contain more than just SKILL.md:

```
skills/issue-editing/
├── SKILL.md           # Main skill definition (required)
├── templates/         # Reusable templates
│   └── issue-body.md
├── examples/          # Example inputs/outputs
└── scripts/           # Helper scripts
```

All `.md` files in the skill directory are loaded into the agent's context.

## Key Principles

1. **No hardcoded prompts**: All agent behavior comes from `.md` files in the role folder
2. **Sealed capsules**: Each agent only sees its own role folder — no shared context injection
3. **Config-driven**: Drop files to change behavior, don't edit TypeScript
4. **Context budget**: Keep files concise. Everything in the role folder is loaded into the context window
5. **Exclude logs**: The `log/` subdirectory (when present) is excluded from context loading

## Reference

- [Agent Skills standard](https://agentskills.io/)
- [GitHub Copilot custom agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- Our agent loader: `src/dashboard/chat-manager.ts` → `loadRoleContext()` recursively reads `.md` files

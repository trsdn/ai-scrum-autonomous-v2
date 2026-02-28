---
name: issue-editing
description: "Edit GitHub issues via gh CLI — read issue details, update body, manage labels, add comments. Use when refining ideas into actionable issues."
---

# Skill: Issue Editing

Edit GitHub issues via `gh` CLI.

## When to Use

- Updating an issue body after refinement
- Adding or removing labels during status transitions
- Adding comments to document refinement decisions

## Commands

```bash
# Read issue
gh issue view <number>
gh issue view <number> --json title,body,labels,milestone

# Update issue body
gh issue edit <number> --body "new body content"

# Manage labels
gh issue edit <number> --add-label "status:refined"
gh issue edit <number> --remove-label "type:idea"

# Add comment
gh issue comment <number> --body "Refinement complete. See updated description."
```

## Rules

- Always read the full issue before editing
- Show the user the proposed body before saving
- Never remove labels without stating why

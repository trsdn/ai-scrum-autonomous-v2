---
name: sprint-planning
description: "Sprint planning workflow — fetch backlog, ICE score issues, analyze dependencies, select sprint scope, assign milestones. Use when planning a new sprint."
---

# Skill: Sprint Planning

## When to Use

- Starting a new sprint planning session
- Re-evaluating sprint scope mid-sprint
- Triaging newly refined issues into the backlog

## Steps

1. **Fetch backlog**: `gh issue list --label "status:refined" --state open --json number,title,labels,body`
2. **Check velocity**: Read `docs/sprints/` for historical sprint data
3. **ICE Score** each issue:
   - Impact (1-10): project value
   - Confidence (1-10): solution clarity
   - Ease (1-10): inverse of effort
4. **Build dependency graph**: check issue bodies for "depends on #N" references
5. **Select scope**: top-scored issues within velocity budget
6. **Assign milestone**: `gh issue edit <N> --milestone "Sprint X" --add-label "status:planned"`

## Sizing

| Effort | Lines | Scope |
|--------|-------|-------|
| 1 | <50 | Config, single file |
| 2 | ~150 | New module, multi-file |
| 3 | ~300 | Cross-cutting, integration |

## Constraints

- Never exceed configured max_issues
- Respect dependency order
- If >2 unplanned issues appear, escalate

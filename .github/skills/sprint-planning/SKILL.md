---
name: sprint-planning
description: "Quick sprint planning for manual use. Triggers on: 'sprint planning', 'plan sprint', 'planning start'."
---

# Sprint Planning

Triage the backlog and select scope for the next sprint.

## Steps

1. **Triage backlog** — List open issues with `gh issue list --state open --label "type:feature,type:bug"`. Remove stale or duplicate issues.
2. **ICE score** — Score each candidate issue: Impact (1-10) × Confidence (1-10) × Ease (1-10). Rank by total.
3. **Select scope** — Pick top-ranked issues that fit the sprint capacity. Confirm with stakeholder before locking.
4. **Set labels** — Apply `sprint:current` label to selected issues. Ensure each has `priority:*` and `type:*` labels.

## Rules

- Sprint scope is locked after planning completes. Discovered work goes to backlog.
- Every selected issue must have testable acceptance criteria before implementation starts.
- Do NOT auto-close or reprioritize issues — escalate to stakeholder.
- If >6 issues are selected, flag as overloaded and ask stakeholder to trim.

## Expected Outputs

- Ranked issue list with ICE scores
- Sprint scope (list of issue numbers)
- Labels applied to all selected issues

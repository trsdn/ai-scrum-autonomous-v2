---
name: direction-gate
description: "Structured review before strategic direction changes. Triggers on: 'direction change', 'strategic decision', 'pivot'."
---

# Direction Gate

Evaluate strategic direction changes before execution.

## Steps

1. **Document current state** — Describe the current approach, what works, and what prompted the change request.
2. **Analyze alternatives** — List at least 2-3 alternatives with pros/cons. Include "do nothing" as an option.
3. **Recommend** — State the recommended path with rationale. Be explicit about trade-offs and risks.
4. **Escalate** — Present the analysis to the stakeholder for a decision. Do NOT proceed without explicit approval.

## Rules

- Never execute a direction change without stakeholder approval.
- Always include "do nothing" as a baseline option.
- Quantify impact where possible (effort, risk, timeline).
- If the change affects architectural decisions, reference relevant ADRs in `docs/architecture/ADR.md`.
- Document the final decision for future reference.

## Expected Outputs

- Current state summary
- Alternatives table with pros/cons
- Recommendation with rationale
- Stakeholder decision (approved / rejected / deferred)

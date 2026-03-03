# Sprint Documentation

You are documenting Sprint {{SPRINT_NUMBER}} for the {{PROJECT_NAME}} project ({{REPO_OWNER}}/{{REPO_NAME}}).

## Task

Generate or update documentation artifacts based on the sprint results.

## Context

- Repository: {{REPO_OWNER}}/{{REPO_NAME}}
- Sprint: {{SPRINT_NUMBER}}
- Base branch: {{BASE_BRANCH}}

## Sprint Data

{{SPRINT_REVIEW_DATA}}

## Instructions

### 1. Update CHANGELOG.md

Add a new section for this sprint:
```markdown
## [Sprint {{SPRINT_NUMBER}}] - YYYY-MM-DD

### Added
- (list new features)

### Changed
- (list modifications)

### Fixed
- (list bug fixes)
```

### 2. Check Architecture Docs

Review if any changes in this sprint affect:
- `docs/architecture/ADR.md` — Flag if new ADRs are needed (do NOT modify without confirmation)
- System architecture diagrams or descriptions

### 3. Update User Documentation

If new features were added (CLI commands, dashboard pages, config options), update the relevant user-facing docs:
- `README.md` — Quick start, feature list
- `docs/` — Detailed guides

### 4. Generate Summary

Provide a brief sprint documentation summary:
- What was documented
- What needs stakeholder review
- Any gaps or stale documentation found

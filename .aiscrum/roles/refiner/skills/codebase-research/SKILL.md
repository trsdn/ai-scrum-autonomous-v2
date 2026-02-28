---
name: codebase-research
description: "Research the codebase to inform refinement decisions — search source code, check ADRs, review dependencies, find existing tests."
---

# Skill: Codebase Research

Research the codebase to inform refinement decisions.

## When to Use

- Before writing acceptance criteria — understand what already exists
- When an idea references existing functionality
- When estimating effort — knowing the codebase helps size accurately

## Steps

1. **Search for related code**: `grep -r "keyword" src/` or use file search
2. **Check architecture decisions**: Read `docs/architecture/ADR.md`
3. **Review dependencies**: Check `package.json` for relevant libraries
4. **Find existing tests**: Look in `tests/` for related test files

## When to Use

- Before writing acceptance criteria — understand what already exists
- When an idea references existing functionality
- When estimating effort — knowing the codebase helps size accurately

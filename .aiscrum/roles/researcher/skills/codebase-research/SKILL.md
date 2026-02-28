---
name: codebase-research
description: "Deep codebase analysis — search source code, read implementations, check ADRs, review dependencies, find tests, check git history. Use when investigating issues or answering questions about the codebase."
---

# Skill: Codebase Research

Deep codebase analysis for answering questions and investigating issues.

## When to Use

- Investigating a bug report or unexpected behavior
- Answering questions about how a feature works
- Researching before proposing architectural changes
- Finding all usages of a function or pattern

## Steps

1. **Search for related code**: `grep -r "keyword" src/` or use file search
2. **Read implementations**: view source files to understand logic
3. **Check architecture decisions**: read `docs/architecture/ADR.md`
4. **Review dependencies**: check `package.json` for relevant libraries
5. **Find existing tests**: look in `tests/` for related test files
6. **Check git history**: `git log --oneline -20` for recent changes

## Commands

```bash
grep -rn "pattern" src/           # Search source code
find src/ -name "*.ts" | head     # List source files
git log --oneline -20             # Recent commits
git diff HEAD~5                    # Recent changes
cat docs/architecture/ADR.md      # Architecture decisions
```

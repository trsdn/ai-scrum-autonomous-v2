# Skill: TDD Workflow

Test-driven development cycle for validating changes.

## Steps

1. **Write test first** — define expected behavior before checking implementation
2. **Run tests** — `npx vitest run` to verify current state
3. **Check coverage** — `npx vitest run --coverage` for coverage report
4. **Verify red→green** — new tests should fail before fix, pass after

## Commands

```bash
npx vitest run                    # Run all tests
npx vitest run tests/specific/    # Run specific test file
npx vitest run --coverage         # Coverage report
npx tsc --noEmit                  # Type check
npx eslint src/                   # Lint check
```

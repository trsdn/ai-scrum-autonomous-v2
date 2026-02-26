---
name: tdd-workflow
description: "Test-driven development cycle. Triggers on: 'TDD', 'test first', 'write tests'."
---

# TDD Workflow

Implement features using red-green-refactor cycle.

## Steps

1. **Write failing test** — Write a test that captures the expected behavior. Run it and confirm it fails (red).
2. **Implement** — Write the minimal code to make the test pass. Do not over-engineer.
3. **Verify green** — Run the full test suite. All tests must pass, including the new one.
4. **Refactor** — Clean up the implementation while keeping tests green. Extract, rename, simplify.

## Rules

- Never write implementation before the test exists and fails.
- Each cycle should be small — one behavior per test.
- Run the full test suite after each change, not just the new test.
- If a refactor breaks a test, fix the code not the test (unless the test was wrong).

## Expected Outputs

- Failing test (red) with clear assertion message
- Passing test suite (green) after implementation
- Clean code after refactor, all tests still green

---
name: tdd-workflow
description: "Test-Driven Development workflow. Triggers on: 'TDD', 'test first', 'write tests'."
---

# TDD Workflow

Write failing tests first, then implement code to make them pass.

> **When to use**: RECOMMENDED for all feature issues. REQUIRED when the issue has Given/When/Then acceptance criteria. The acceptance criteria on the issue ARE your test specifications.

## When to Use

- Implementing a user story with acceptance criteria
- Building new features with clear requirements
- Refactoring with safety net

## When NOT to Use

- Exploratory prototyping
- UI/visual changes
- One-off scripts
- Documentation changes

## The TDD Cycle

```
┌─────────────────────────────────────────────┐
│  1. RED    │  Write a failing test          │
├─────────────────────────────────────────────┤
│  2. GREEN  │  Write minimal code to pass    │
├─────────────────────────────────────────────┤
│  3. REFACTOR │  Improve code, keep tests green │
└─────────────────────────────────────────────┘
         ↑                                    │
         └────────────────────────────────────┘
```

## Workflow Steps

### Step 1: Parse Acceptance Criteria

Convert each Given/When/Then into a test case.

### Step 2: Write Test File First

Create test file before implementation.

| Language | Pattern | Example |
|----------|---------|---------|
| Python | `test_<module>.py` | `test_logout.py` |
| JavaScript | `<module>.test.js` | `logout.test.js` |
| TypeScript | `<module>.spec.ts` | `logout.spec.ts` |
| Go | `<module>_test.go` | `logout_test.go` |

### Step 3: Run Test (Expect Failure)

```bash
uv run pytest tests/path/test_module.py -v
```

**Expected output:** RED (failing test)

### Step 4: Implement Minimum Code

Write just enough to make the test pass.

### Step 5: Run Test (Expect Pass)

**Expected output:** GREEN (all tests pass)

### Step 6: Refactor

Improve code quality while keeping tests green:
- Extract helper functions
- Improve naming
- Remove duplication
- Add type hints

### Step 7: Repeat for Next Criterion

## Test Structure Template (Python)

```python
"""Tests for [feature] - Issue #XXX"""
import pytest


class TestFeatureName:
    """Tests for [acceptance criteria group]"""

    @pytest.fixture
    def setup_data(self):
        """Given: [precondition]"""
        return create_test_data()

    def test_when_action_then_result(self, setup_data):
        """
        Given: [precondition]
        When: [action]
        Then: [expected result]
        """
        result = function_under_test(setup_data)
        assert result == expected_value

    def test_edge_case(self, setup_data):
        """Edge case: [description]"""
        pass
```

## Checklist Before Implementation

- [ ] All acceptance criteria have corresponding tests
- [ ] Tests are in correct location (`tests/` mirror of `src/`)
- [ ] Test file created before implementation file
- [ ] Tests run and fail for the right reason
- [ ] Edge cases identified and have tests

## Test Quality — The Point of TDD

TDD exists to **prove the code works correctly**, not to generate coverage numbers. Every test must answer: "What would break if this code were wrong?"

### Bad Tests (NEVER write these)

```python
# ❌ Only checks it doesn't crash
def test_feature_runs():
    result = do_something(input)
    assert result is not None

# ❌ Checks type instead of value
def test_returns_list():
    result = process(data)
    assert isinstance(result, list)

# ❌ Mocks so much that nothing real is tested
def test_with_everything_mocked(mocker):
    mocker.patch("module.dep1", return_value=fake1)
    mocker.patch("module.dep2", return_value=fake2)
    result = module.run()  # what are we testing?
    assert result == fake2
```

### The Litmus Test

For every test, ask: **"If I introduced a bug that changed the output, would this test catch it?"**

If the answer is no, the test is coverage theater. Rewrite it.

Coverage is a side effect of good tests, not a goal.

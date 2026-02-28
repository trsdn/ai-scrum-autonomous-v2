# Test Strategy

## Test Architecture

The project uses a 4-layer testing pyramid:

| Layer | Framework | Files | Purpose |
|-------|-----------|-------|---------|
| **Unit** | Vitest | ~45 | Isolated module tests, mock-heavy |
| **Integration** | Vitest | 1 | End-to-end ceremony flow |
| **Smoke** | Vitest | 1 | Basic sanity checks |
| **E2E** | Playwright | 1 | Dashboard browser testing |

### Directory Structure

```
tests/
├── *.test.ts              # Core modules (config, events, runner, state, metrics, logger)
├── acp/                   # ACP client, permissions, session config
├── ceremonies/            # All ceremony tests (planning, execution, review, retro, etc.)
├── cli/                   # CLI helpers, init command
├── dashboard/             # WebSocket server, chat, issue cache, session control
├── documentation/         # Sprint logs, huddles, velocity
├── e2e/                   # Playwright browser tests
├── enforcement/           # Quality gate, drift, escalation, challenger, code review
├── git/                   # Worktree, merge, diff analysis
├── github/                # Issues, labels, milestones, rate limiter
└── integration/           # Full sprint cycle test
```

Test files mirror the `src/` directory structure (e.g., `src/ceremonies/execution.ts` → `tests/ceremonies/execution.test.ts`).

---

## Test Configuration

### Vitest (`vitest.config.ts`)

- **Environment**: Node.js with globals enabled
- **File pattern**: `tests/**/*.test.ts`
- **Coverage provider**: `v8` (via `@vitest/coverage-v8`)
- **Coverage reporters**: `text`, `json-summary`, `html`
- **Coverage includes**: `src/**/*.ts` (excludes `src/index.ts`)

### Playwright (`playwright.config.ts`)

- **Test directory**: `./tests/e2e`
- **Browser**: Chromium (headless)
- **Timeout**: 30s per test, 1 retry on failure
- **Base URL**: `http://localhost:9200`
- **Web server**: Auto-starts dashboard on port 9200 before tests

---

## Running Tests

| Command | Description |
|---------|-------------|
| `npm test` / `npx vitest run` | Full test suite |
| `npx vitest run --watch` | Watch mode |
| `npx vitest run --coverage` | With coverage report |
| `make test-quick` | Fast-fail (stops on first failure) |
| `make test-e2e` | Playwright E2E tests |
| `make test-web` | Dashboard-specific tests |
| `make check` | Lint + types + tests |

### Running specific tests

```bash
# Single file
npx vitest run tests/ceremonies/execution.test.ts

# By pattern
npx vitest run -t "quality gate"

# With verbose output
npx vitest run --reporter=verbose
```

---

## Test Data Management

### Setup (`scripts/test-setup.sh`)

Creates isolated test infrastructure:

```bash
# Default: 2 sprints, 3 issues per sprint
./scripts/test-setup.sh

# Custom: 5 sprints, 4 issues each
./scripts/test-setup.sh --sprints 5 --issues-per-sprint 4
```

- Creates "Test Sprint N" milestones (isolated from production "Sprint N")
- Creates template issues with realistic acceptance criteria
- Labels all test issues with `test-run` and `status:ready`

### Cleanup (`scripts/test-cleanup.sh`)

Removes all test artifacts:

```bash
# Full cleanup
./scripts/test-cleanup.sh

# Keep issues for reuse
./scripts/test-cleanup.sh --keep-issues
```

Cleans: milestones, issues, branches (`test-sprint/*`), state files, logs, git worktrees.

---

## Writing New Tests

### File naming

Place tests at `tests/<module>/<file>.test.ts` mirroring the `src/` structure.

### Mock patterns

The codebase uses `vi.mock()` for module-level mocking:

```typescript
// Mock an entire module
vi.mock("../../src/github/issues.js", () => ({
  addComment: vi.fn().mockResolvedValue(undefined),
}));

// Mock with implementation
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockImplementation((path: string) => {
      if (path.includes("planner")) return Promise.resolve("plan template");
      return Promise.resolve("default template");
    }),
  },
}));

// Access mocked function for assertions
const { addComment } = await import("../../src/github/issues.js");
expect(addComment).toHaveBeenCalledWith(42, "comment text");
```

### Test isolation

- Each test should be independent — use `beforeEach(() => vi.clearAllMocks())`
- Note: `clearAllMocks` resets call counts but not `mockResolvedValue` implementations
- Use `vi.mocked(fn).mockResolvedValue(...)` within each test for state-dependent mocks

### Conventions

- Use `describe` and `it` blocks
- Use `vi.fn()` for mocks, `vi.mocked()` for type-safe access
- Imports use `.js` extensions (ESM convention)
- Helper functions (e.g., `makeConfig()`, `makeIssue()`) defined per test file

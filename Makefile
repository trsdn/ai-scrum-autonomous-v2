.PHONY: help check fix lint format typecheck test test-quick coverage build notify clean install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# === Setup ===

install: ## Install dependencies
	npm install

# === Quality ===

lint: ## Run linter
	npx eslint src/ tests/

format: ## Format code
	npx prettier --write 'src/**/*.ts' 'tests/**/*.ts'

fix: ## Auto-fix lint issues and format
	npx eslint src/ tests/ --fix
	npx prettier --write 'src/**/*.ts' 'tests/**/*.ts'

typecheck: ## Run type checker
	npx tsc --noEmit

check: lint typecheck test ## Run lint + types + tests

# === Build ===

build: ## Build TypeScript
	npx tsc

dev: ## Run in dev mode
	npx tsx src/index.ts

# === Testing ===

test: ## Run all tests
	npx vitest run

test-quick: ## Run tests with fast fail
	npx vitest run --bail 1

test-watch: ## Run tests in watch mode
	npx vitest

coverage: ## Run tests with coverage report
	npx vitest run --coverage

# === Notifications ===

notify: ## Send notification (MSG="your message")
	@if [ -n "$$NTFY_TOPIC" ]; then \
		curl -s -H "Title: $(or $(TITLE),Project Notification)" \
			-d "$(or $(MSG),Task completed)" \
			ntfy.sh/$$NTFY_TOPIC; \
		echo ""; \
	else \
		echo "NTFY_TOPIC not set. Run: export NTFY_TOPIC=your-topic"; \
	fi

# === Cleanup ===

clean: ## Remove build artifacts
	rm -rf dist/
	rm -rf coverage/ .vitest/

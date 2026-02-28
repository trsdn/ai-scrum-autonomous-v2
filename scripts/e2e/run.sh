#!/usr/bin/env bash
# scripts/e2e/run.sh — Run a headless sprint against the test project
#
# Executes a full sprint cycle (refine → plan → execute → review → retro)
# against the test project. No dashboard, no user interaction.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_DIR="${1:-/Users/torstenmahr/dev/GitHub/ai-scrum-test-project}"
SPRINT="${2:-1}"

echo "🚀 E2E Run: Sprint $SPRINT against $(basename "$PROJECT_DIR")"
echo "   Runner: $RUNNER_DIR"
echo "   Project: $PROJECT_DIR"
echo ""

# Ensure runner is built
echo "📦 Building sprint runner..."
cd "$RUNNER_DIR"
npm run build 2>&1 | tail -1
echo "  ✅ Built"

# Run full cycle
echo ""
echo "▶ Starting sprint $SPRINT..."
echo "   $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

cd "$PROJECT_DIR"
START_TIME=$(date +%s)

# Run with timeout (45 minutes max) — use gtimeout on macOS, timeout on Linux
TIMEOUT_CMD="timeout"
if command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout"
elif ! command -v timeout &>/dev/null; then
  TIMEOUT_CMD=""
fi

if [[ -n "$TIMEOUT_CMD" ]]; then
  $TIMEOUT_CMD 2700 node "$RUNNER_DIR/dist/index.js" full-cycle --sprint "$SPRINT" 2>&1 | tee "$PROJECT_DIR/e2e-run.log"
else
  node "$RUNNER_DIR/dist/index.js" full-cycle --sprint "$SPRINT" 2>&1 | tee "$PROJECT_DIR/e2e-run.log"
fi
EXIT_CODE=${PIPESTATUS[0]}

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "⏱️  Duration: ${MINUTES}m ${SECONDS}s"
echo "📋 Exit code: $EXIT_CODE"
echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅ Sprint completed successfully"
else
  echo "❌ Sprint failed (exit code: $EXIT_CODE)"
fi

echo ""
echo "▶ Next: ./scripts/e2e/verify.sh"
exit $EXIT_CODE

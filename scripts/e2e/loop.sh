#!/usr/bin/env bash
# scripts/e2e/loop.sh — Run E2E stabilization loop N times
#
# Usage: ./scripts/e2e/loop.sh [iterations] [project-dir]
#
# Orchestrates: reset → setup → run → verify for each iteration.
# Aggregates results across all runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ITERATIONS="${1:-3}"
PROJECT_DIR="${2:-/Users/torstenmahr/dev/GitHub/ai-scrum-test-project}"
RESULTS_DIR="$SCRIPT_DIR/results"

mkdir -p "$RESULTS_DIR"

echo "🔁 E2E Stabilization Loop: $ITERATIONS iterations"
echo "   Project: $PROJECT_DIR"
echo "   Results: $RESULTS_DIR"
echo ""

PASSES=0
FAILURES=0

for i in $(seq 1 "$ITERATIONS"); do
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║  ITERATION $i / $ITERATIONS"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  RUN_LOG="$RESULTS_DIR/run-$i.log"
  VERIFY_LOG="$RESULTS_DIR/verify-$i.log"
  START=$(date +%s)

  # Step 1: Reset
  echo "── Step 1/4: Reset ──"
  bash "$SCRIPT_DIR/reset.sh" "$PROJECT_DIR" 2>&1 | tail -5

  # Step 2: Setup
  echo ""
  echo "── Step 2/4: Setup ──"
  bash "$SCRIPT_DIR/setup.sh" 2>&1 | tail -5

  # Step 3: Run
  echo ""
  echo "── Step 3/4: Run Sprint ──"
  run_exit=0
  bash "$SCRIPT_DIR/run.sh" "$PROJECT_DIR" 1 2>&1 | tee "$RUN_LOG" | tail -10 || run_exit=$?

  # Step 4: Verify
  echo ""
  echo "── Step 4/4: Verify ──"
  verify_exit=0
  bash "$SCRIPT_DIR/verify.sh" "$PROJECT_DIR" "run-$i" 2>&1 | tee "$VERIFY_LOG" || verify_exit=$?

  END=$(date +%s)
  DURATION=$((END - START))

  if [[ $verify_exit -eq 0 ]]; then
    ((PASSES++)) || true
    echo ""
    echo "✅ Iteration $i PASSED (${DURATION}s)"
  else
    ((FAILURES++)) || true
    echo ""
    echo "❌ Iteration $i FAILED (${DURATION}s)"
  fi
done

# --- Aggregate results ---
echo ""
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  AGGREGATE RESULTS ($ITERATIONS runs)   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Passes:   $PASSES / $ITERATIONS"
echo "  Failures: $FAILURES / $ITERATIONS"

if [[ $ITERATIONS -gt 0 ]]; then
  RATE=$((PASSES * 100 / ITERATIONS))
  echo "  Pass rate: ${RATE}%"
  echo ""

  if [[ $RATE -ge 80 ]]; then
    echo "✅ STABLE: ${RATE}% pass rate meets 80% threshold"
    exit 0
  else
    echo "❌ UNSTABLE: ${RATE}% pass rate below 80% threshold"
    echo ""
    echo "Check individual run logs in: $RESULTS_DIR/"
    exit 1
  fi
fi

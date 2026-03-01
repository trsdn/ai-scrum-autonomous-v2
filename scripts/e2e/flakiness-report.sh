#!/usr/bin/env bash
# scripts/e2e/flakiness-report.sh — Show flakiness report from E2E history
#
# Usage: ./scripts/e2e/flakiness-report.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HISTORY_FILE="$SCRIPT_DIR/results/history.json"

if [[ ! -f "$HISTORY_FILE" ]]; then
  echo "No history file found at $HISTORY_FILE"
  echo "Run verify.sh with a run label to start recording."
  exit 1
fi

run_count=$(jq '.runs | length' "$HISTORY_FILE")

if [[ "$run_count" -lt 1 ]]; then
  echo "No runs recorded yet."
  exit 0
fi

echo "╔══════════════════════════════════════════╗"
echo "║  FLAKINESS REPORT ($run_count runs)      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Run history summary
echo "📅 Run history:"
jq -r '.runs[] | "  \(.label) — \(.timestamp) — \(.pass)/\(.total) passed"' "$HISTORY_FILE"
echo ""

# Per-scenario breakdown
echo "📊 Per-scenario results (sorted by pass rate):"
echo "───────────────────────────────────────────"
jq -r '
  [.runs[].scenarios[]] | group_by(.id) | map({
    id: .[0].id,
    expected: .[0].expected,
    runs: length,
    passes: [.[] | select(.passed)] | length,
    rate: (([.[] | select(.passed)] | length) * 100 / length),
    flaky: (([.[] | select(.passed)] | length) > 0 and ([.[] | select(.passed)] | length) < length)
  }) |
  sort_by(.rate) |
  .[] |
  (if .flaky then "⚠️" elif .rate == 100 then "✅" elif .rate == 0 then "❌" else "  " end) +
  " \(.id | . + " " * (25 - length)) \(.rate)% (\(.passes)/\(.runs)) expected=\(.expected)" +
  (if .flaky then " [FLAKY]" else "" end)
' "$HISTORY_FILE"
echo "───────────────────────────────────────────"

# Summary stats
echo ""
echo "📈 Summary:"
jq -r '
  [.runs[].scenarios[]] | group_by(.id) as $groups |
  {
    total_scenarios: ($groups | length),
    always_pass: [$groups[] | select(all(.passed)) | .[0].id] | length,
    always_fail: [$groups[] | select(all(.passed | not)) | .[0].id] | length,
    flaky: [$groups[] | select(
      ([.[] | select(.passed)] | length) > 0 and
      ([.[] | select(.passed)] | length) < length
    ) | .[0].id] | length
  } |
  "  Total scenarios tracked: \(.total_scenarios)\n  Always pass: \(.always_pass)\n  Always fail: \(.always_fail)\n  Flaky: \(.flaky)"
' "$HISTORY_FILE"

# Distinguish framework vs agent failures
echo ""
echo "🔍 Failure analysis:"
jq -r '
  [.runs[].scenarios[] | select(.passed | not)] |
  group_by(.id) |
  map({id: .[0].id, expected: .[0].expected, failures: length, actuals: [.[].actual] | unique}) |
  sort_by(-.failures) |
  limit(10; .[]) |
  "  \(.id): \(.failures) failure(s) — expected=\(.expected), actual outcomes: \(.actuals | join(", "))"
' "$HISTORY_FILE"

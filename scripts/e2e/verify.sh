#!/usr/bin/env bash
# scripts/e2e/verify.sh — Verify expected outcomes after a sprint run
#
# Checks each scenario's expected outcome against actual GitHub state.
# Outputs a structured report. Optionally records results for flakiness tracking.
#
# Usage: ./scripts/e2e/verify.sh [project-dir] [run-label]
#   run-label: optional label for flakiness tracking (e.g., "run-1", "sprint-2")

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="trsdn/ai-scrum-test-project"
PROJECT_DIR="${1:-/Users/torstenmahr/dev/GitHub/ai-scrum-test-project}"
RUN_LABEL="${2:-run-$(date +%Y%m%dT%H%M%S)}"
SCENARIOS="$SCRIPT_DIR/scenarios.json"
HISTORY_FILE="$SCRIPT_DIR/results/history.json"

PASS=0
FAIL=0
TOTAL=0
REPORT=""
# Collect per-scenario results for flakiness tracking
declare -a SCENARIO_RESULTS=()

check() {
  local name="$1"
  local result="$2"  # "pass" or "fail"
  local detail="$3"
  ((TOTAL++)) || true
  if [[ "$result" == "pass" ]]; then
    ((PASS++)) || true
    REPORT+="  ✅ $name: $detail\n"
  else
    ((FAIL++)) || true
    REPORT+="  ❌ $name: $detail\n"
  fi
}

echo "🔍 E2E Verify: Checking outcomes"
echo ""

# --- 1. Check each scenario ---
echo "📋 Scenario outcomes:"
scenario_count=$(jq '.scenarios | length' "$SCENARIOS")

for i in $(seq 0 $((scenario_count - 1))); do
  id=$(jq -r ".scenarios[$i].id" "$SCENARIOS")
  title=$(jq -r ".scenarios[$i].title" "$SCENARIOS")
  expected=$(jq -r ".scenarios[$i].expected" "$SCENARIOS")

  # Find issue by title
  issue_json=$(gh issue list --repo "$REPO" --state all --json number,title,labels,state --limit 100 2>/dev/null | jq -r ".[] | select(.title==\"$title\")" 2>/dev/null)

  if [[ -z "$issue_json" ]]; then
    if [[ "$expected" == "skipped" ]]; then
      # No issue found for expected-skip is acceptable (may not have been created)
      check "$id" "pass" "Issue not created (expected skip)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"skipped\",\"passed\":true}")
    else
      check "$id" "fail" "Issue not found: $title"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"not-found\",\"passed\":false}")
    fi
    continue
  fi

  issue_num=$(echo "$issue_json" | jq -r '.number')
  issue_state=$(echo "$issue_json" | jq -r '.state')
  labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null | tr '\n' ',' | sed 's/,$//')

  if [[ "$expected" == "completed" ]]; then
    # Check for status:done label or CLOSED state
    if echo "$labels" | grep -q "status:done" || [[ "$issue_state" == "CLOSED" ]]; then
      check "$id" "pass" "#$issue_num completed (labels: $labels)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"completed\",\"passed\":true}")
    else
      check "$id" "fail" "#$issue_num expected completed but got labels: [$labels], state: $issue_state"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"not-completed\",\"passed\":false}")
    fi

    # Check if PR was merged
    pr_merged=$(gh pr list --repo "$REPO" --state merged --json headRefName -q '.[].headRefName' 2>/dev/null | grep -c "issue-$issue_num" || true)
    if [[ "$pr_merged" -gt 0 ]]; then
      check "${id}-pr" "pass" "PR for #$issue_num merged"
    else
      check "${id}-pr" "fail" "No merged PR found for #$issue_num"
    fi

  elif [[ "$expected" == "failed" ]]; then
    # Expected failure — should have status:blocked label
    if echo "$labels" | grep -q "status:blocked"; then
      check "$id" "pass" "#$issue_num blocked as expected (labels: $labels)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"blocked\",\"passed\":true}")
    elif echo "$labels" | grep -q "status:done" || [[ "$issue_state" == "CLOSED" ]]; then
      check "$id" "fail" "#$issue_num should have failed but was completed (false positive)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"completed\",\"passed\":false}")
    else
      # Not blocked but also not completed — might not have been selected
      if echo "$labels" | grep -q "status:in-progress\|status:planned"; then
        check "$id" "pass" "#$issue_num failed during execution (labels: $labels)"
        SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"failed\",\"passed\":true}")
      else
        check "$id" "pass" "#$issue_num not selected (labels: $labels) — acceptable for expected-fail"
        SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"not-selected\",\"passed\":true}")
      fi
    fi

    # Check that NO PR was merged for expected-fail scenarios
    pr_merged=$(gh pr list --repo "$REPO" --state merged --json headRefName -q '.[].headRefName' 2>/dev/null | grep -c "issue-$issue_num" || true)
    if [[ "$pr_merged" -gt 0 ]]; then
      check "${id}-no-merge" "fail" "PR for expected-fail #$issue_num was merged (should not happen)"
    else
      check "${id}-no-merge" "pass" "No merged PR for expected-fail #$issue_num (correct)"
    fi

  elif [[ "$expected" == "skipped" ]]; then
    # Expected skip — should NOT have been selected for the sprint
    if echo "$labels" | grep -q "status:planned\|status:in-progress\|status:done\|status:blocked"; then
      check "$id" "fail" "#$issue_num was selected but should have been skipped (labels: $labels)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"selected\",\"passed\":false}")
    else
      check "$id" "pass" "#$issue_num was not selected (correct — expected skip, labels: $labels)"
      SCENARIO_RESULTS+=("{\"id\":\"$id\",\"expected\":\"$expected\",\"actual\":\"skipped\",\"passed\":true}")
    fi
  fi
done

# --- 2. Main branch health ---
echo ""
echo "🏥 Main branch health:"
cd "$PROJECT_DIR"
git checkout main 2>/dev/null
git pull origin main 2>/dev/null

if npx vitest run 2>/dev/null; then
  check "main-tests" "pass" "Tests pass on main"
else
  check "main-tests" "fail" "Tests FAIL on main"
fi

if npx tsc --noEmit 2>/dev/null; then
  check "main-types" "pass" "Types clean on main"
else
  check "main-types" "fail" "Type errors on main"
fi

if npx eslint src/ tests/ 2>/dev/null; then
  check "main-lint" "pass" "Lint clean on main"
else
  check "main-lint" "fail" "Lint errors on main"
fi

# --- 3. Sprint state file ---
echo ""
echo "📄 Sprint artifacts:"
STATE_FILE=$(find docs/sprints/ -name '*-state.json' -not -name '*.lock' 2>/dev/null | sort | tail -1)
if [[ -n "$STATE_FILE" ]]; then
  phase=$(jq -r '.phase' "$STATE_FILE" 2>/dev/null)
  if [[ "$phase" == "complete" ]]; then
    check "state-phase" "pass" "Sprint phase: $phase"
  else
    check "state-phase" "fail" "Sprint phase: $phase (expected: complete)"
  fi

  # Check retro ran
  retro=$(jq -r '.retro' "$STATE_FILE" 2>/dev/null)
  if [[ "$retro" != "null" && -n "$retro" ]]; then
    check "retro-ran" "pass" "Retro executed"
  else
    check "retro-ran" "fail" "Retro did not run"
  fi
else
  check "state-phase" "fail" "No state file found"
  check "retro-ran" "fail" "No state file found"
fi

# Sprint log exists
LOG_FILE=$(find docs/sprints/ -name '*-log.md' 2>/dev/null | head -1)
if [[ -n "$LOG_FILE" ]]; then
  check "sprint-log" "pass" "Sprint log exists: $(basename "$LOG_FILE")"
else
  check "sprint-log" "fail" "No sprint log found"
fi

# --- 4. No orphaned worktrees ---
echo ""
echo "🌲 Resource cleanup:"
orphan_count=$(git worktree list 2>/dev/null | grep -c "issue-" || true)
if [[ "$orphan_count" -eq 0 ]]; then
  check "no-orphan-wt" "pass" "No orphaned worktrees"
else
  check "no-orphan-wt" "fail" "$orphan_count orphaned worktrees found"
fi

# --- 5. Escalation for expected failures ---
echo ""
echo "📢 Escalation checks:"
escalation_count=$(gh issue list --repo "$REPO" --label "type:escalation" --state all --json number,title -q '.[].number' 2>/dev/null | wc -l | tr -d ' ')
# Count how many expected-fail scenarios were actually selected for the sprint
selected_fails=0
for i in $(seq 0 $((scenario_count - 1))); do
  expected=$(jq -r ".scenarios[$i].expected" "$SCENARIOS")
  if [[ "$expected" == "failed" ]]; then
    title=$(jq -r ".scenarios[$i].title" "$SCENARIOS")
    issue_json=$(gh issue list --repo "$REPO" --state all --json number,title,labels --limit 100 2>/dev/null | jq -r ".[] | select(.title==\"$title\")" 2>/dev/null)
    if [[ -n "$issue_json" ]]; then
      labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
      if echo "$labels" | grep -q "status:blocked\|status:in-progress\|status:done"; then
        ((selected_fails++)) || true
      fi
    fi
  fi
done

if [[ "$selected_fails" -gt 0 ]]; then
  if [[ "$escalation_count" -gt 0 ]]; then
    check "escalation" "pass" "$escalation_count escalation(s) for $selected_fails failed scenario(s)"
  else
    check "escalation" "fail" "$selected_fails expected-fail scenarios selected but no escalation issues created"
  fi
else
  check "escalation" "pass" "No expected-fail scenarios were selected (escalation N/A)"
fi

# --- 6. Record results for flakiness tracking ---
mkdir -p "$(dirname "$HISTORY_FILE")"
if [[ ${#SCENARIO_RESULTS[@]} -gt 0 ]]; then
  results_json=$(printf '%s\n' "${SCENARIO_RESULTS[@]}" | jq -s '.')
  run_entry=$(jq -n \
    --arg label "$RUN_LABEL" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson pass "$PASS" \
    --argjson fail "$FAIL" \
    --argjson total "$TOTAL" \
    --argjson scenarios "$results_json" \
    '{label: $label, timestamp: $timestamp, pass: $pass, fail: $fail, total: $total, scenarios: $scenarios}')

  if [[ -f "$HISTORY_FILE" ]]; then
    # Append to existing history
    jq --argjson entry "$run_entry" '.runs += [$entry]' "$HISTORY_FILE" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
  else
    # Create new history file
    jq -n --argjson entry "$run_entry" '{runs: [$entry]}' > "$HISTORY_FILE"
  fi
  echo ""
  echo "📈 Results recorded to history (run: $RUN_LABEL)"
fi

# --- Print report ---
echo ""
echo "═══════════════════════════════════════════"
echo "📊 E2E VERIFICATION REPORT"
echo "═══════════════════════════════════════════"
echo ""
echo -e "$REPORT"
echo ""
echo "═══════════════════════════════════════════"
echo "   TOTAL: $TOTAL | PASS: $PASS | FAIL: $FAIL"
RATE=$((PASS * 100 / TOTAL))
echo "   PASS RATE: ${RATE}%"
echo "═══════════════════════════════════════════"

# --- Flakiness report (if history exists with 2+ runs) ---
if [[ -f "$HISTORY_FILE" ]]; then
  run_count=$(jq '.runs | length' "$HISTORY_FILE")
  if [[ "$run_count" -ge 2 ]]; then
    echo ""
    echo "📊 FLAKINESS REPORT ($run_count runs)"
    echo "───────────────────────────────────────────"
    # Calculate pass rate per scenario across all runs
    jq -r '
      .runs as $runs |
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
      " \(.id) — \(.rate)% (\(.passes)/\(.runs)) expected=\(.expected)" +
      (if .flaky then " [FLAKY]" else "" end)
    ' "$HISTORY_FILE"
    echo "───────────────────────────────────────────"

    # Top 5 flakiest
    flaky_count=$(jq '[.runs[].scenarios[]] | group_by(.id) | map(select(
      ([.[] | select(.passed)] | length) > 0 and
      ([.[] | select(.passed)] | length) < length
    )) | length' "$HISTORY_FILE")
    if [[ "$flaky_count" -gt 0 ]]; then
      echo ""
      echo "⚠️  $flaky_count flaky scenario(s) detected (passes sometimes, fails sometimes)"
    else
      echo ""
      echo "✅ No flaky scenarios detected"
    fi
  fi
fi

# Exit with failure if pass rate < 80%
if [[ $RATE -lt 80 ]]; then
  echo ""
  echo "❌ Below 80% pass rate threshold"
  exit 1
else
  echo ""
  echo "✅ Above 80% pass rate threshold"
  exit 0
fi

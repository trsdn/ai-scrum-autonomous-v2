#!/usr/bin/env bash
# scripts/e2e/verify.sh — Verify expected outcomes after a sprint run
#
# Checks each scenario's expected outcome against actual GitHub state.
# Outputs a structured report.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="trsdn/ai-scrum-test-project"
PROJECT_DIR="${1:-/Users/torstenmahr/dev/GitHub/ai-scrum-test-project}"
SCENARIOS="$SCRIPT_DIR/scenarios.json"

PASS=0
FAIL=0
TOTAL=0
REPORT=""

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
  issue_json=$(gh issue list --repo "$REPO" --state all --json number,title,labels,state --limit 50 2>/dev/null | jq -r ".[] | select(.title==\"$title\")" 2>/dev/null)

  if [[ -z "$issue_json" ]]; then
    check "$id" "fail" "Issue not found: $title"
    continue
  fi

  issue_num=$(echo "$issue_json" | jq -r '.number')
  issue_state=$(echo "$issue_json" | jq -r '.state')
  labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null | tr '\n' ',' | sed 's/,$//')

  if [[ "$expected" == "completed" ]]; then
    # Check for status:done label or CLOSED state
    if echo "$labels" | grep -q "status:done" || [[ "$issue_state" == "CLOSED" ]]; then
      check "$id" "pass" "#$issue_num completed (labels: $labels)"
    else
      check "$id" "fail" "#$issue_num expected completed but got labels: [$labels], state: $issue_state"
    fi

    # Check if PR was merged
    pr_merged=$(gh pr list --repo "$REPO" --state merged --json headRefName -q '.[].headRefName' 2>/dev/null | grep -c "issue-$issue_num" || true)
    if [[ "$pr_merged" -gt 0 ]]; then
      check "${id}-pr" "pass" "PR for #$issue_num merged"
    else
      check "${id}-pr" "fail" "No merged PR found for #$issue_num"
    fi

  elif [[ "$expected" == "failed" ]]; then
    # Should be blocked or failed
    if echo "$labels" | grep -q "status:blocked"; then
      check "$id" "pass" "#$issue_num blocked as expected (labels: $labels)"
    elif echo "$labels" | grep -q "status:done" || [[ "$issue_state" == "CLOSED" ]]; then
      check "$id" "fail" "#$issue_num should have failed but was completed"
    else
      check "$id" "pass" "#$issue_num not completed (labels: $labels, state: $issue_state)"
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
STATE_FILE=$(find docs/sprints/ -name '*-state.json' -not -name '*.lock' 2>/dev/null | head -1)
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
escalation_count=$(gh issue list --repo "$REPO" --label "type:escalation" --state all --json number -q '.[].number' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$escalation_count" -gt 0 ]]; then
  check "escalation" "pass" "$escalation_count escalation issue(s) created"
else
  check "escalation" "fail" "No escalation issues found (expected at least 1 for vague scenario)"
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

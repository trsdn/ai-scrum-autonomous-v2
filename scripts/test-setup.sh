#!/usr/bin/env bash
# scripts/test-setup.sh — Create test issues and milestones for sprint runner testing
#
# Usage: ./scripts/test-setup.sh [--sprints N] [--issues-per-sprint N]
#
# Creates:
#   - "Test Sprint 1", "Test Sprint 2", ... milestones
#   - Dummy issues assigned to each milestone with realistic acceptance criteria
#   - Labels issues as status:ready
#
# All artifacts use the "Test Sprint" prefix so they're fully isolated
# from production sprints.

set -euo pipefail

SPRINTS=${1:-2}
ISSUES_PER_SPRINT=${2:-3}
LABEL="test-run"
PREFIX="Test Sprint"

echo "🧪 Test Setup: Creating ${SPRINTS} sprints with ${ISSUES_PER_SPRINT} issues each"
echo ""

# Ensure test-run label exists
if ! gh label list --json name -q '.[].name' | grep -q "^${LABEL}$"; then
  gh label create "${LABEL}" --color "D4C5F9" --description "Test run issue — auto-created, safe to delete" 2>/dev/null || true
  echo "📌 Created label: ${LABEL}"
fi

# Test issue definitions — realistic but clearly test content
ISSUES=(
  "test: Add input validation to config loader|## Acceptance Criteria\n\n- [ ] Validate that \`max_issues\` is between 1 and 50\n- [ ] Validate that \`session_timeout_ms\` is positive\n- [ ] Return clear error message on invalid config\n- [ ] Add unit tests for validation edge cases"
  "test: Add retry count to sprint log output|## Acceptance Criteria\n\n- [ ] Sprint log includes retry count per issue\n- [ ] Format: \`Retries: N\` in huddle entry\n- [ ] Zero retries shows \`Retries: 0\`\n- [ ] Add test covering retry count display"
  "test: Improve error message for missing milestone|## Acceptance Criteria\n\n- [ ] Error message includes the milestone name that was not found\n- [ ] Suggests creating the milestone with correct naming\n- [ ] Error is logged at warn level, not error\n- [ ] Add test for error message format"
  "test: Add elapsed time to quality gate output|## Acceptance Criteria\n\n- [ ] Quality gate result includes \`elapsed_ms\` field\n- [ ] Each individual check has its own duration\n- [ ] Total duration is sum of all checks\n- [ ] Add tests for timing data"
  "test: Export sprint metrics as JSON|## Acceptance Criteria\n\n- [ ] \`sprint-runner metrics --sprint N --json\` outputs JSON\n- [ ] JSON includes: velocity, first_pass_rate, avg_duration_ms\n- [ ] JSON output is valid and parseable\n- [ ] Add test for JSON output format"
  "test: Add issue title to branch name|## Acceptance Criteria\n\n- [ ] Branch pattern supports \`{title}\` placeholder\n- [ ] Title is slugified (lowercase, hyphens, max 40 chars)\n- [ ] Special characters are stripped\n- [ ] Add tests for title slugification"
)

CREATED_ISSUES=()

for sprint_num in $(seq 1 "$SPRINTS"); do
  milestone="${PREFIX} ${sprint_num}"

  # Create milestone if it doesn't exist
  if gh api "repos/{owner}/{repo}/milestones" --paginate -q ".[].title" 2>/dev/null | grep -qF "$milestone"; then
    echo "📋 Milestone already exists: ${milestone}"
  else
    gh api "repos/{owner}/{repo}/milestones" -f "title=${milestone}" -f "description=Test sprint for runner validation" >/dev/null
    echo "📋 Created milestone: ${milestone}"
  fi

  # Create issues for this sprint
  start_idx=$(( (sprint_num - 1) * ISSUES_PER_SPRINT ))
  for i in $(seq 0 $((ISSUES_PER_SPRINT - 1))); do
    idx=$(( (start_idx + i) % ${#ISSUES[@]} ))
    IFS='|' read -r title body <<< "${ISSUES[$idx]}"

    # Add sprint context to title to make each unique
    full_title="${title} (S${sprint_num})"

    # Check if issue already exists
    if gh issue list --label "${LABEL}" --json title -q '.[].title' | grep -qF "$full_title"; then
      echo "  ⏭  Issue already exists: ${full_title}"
      issue_num=$(gh issue list --label "${LABEL}" --json number,title -q ".[] | select(.title==\"${full_title}\") | .number")
    else
      issue_num=$(gh issue create \
        --title "$full_title" \
        --body "$(echo -e "$body")" \
        --label "${LABEL}" \
        --label "status:ready" \
        --milestone "${milestone}" \
        2>/dev/null | grep -o '[0-9]*$')
      echo "  ✅ Created issue #${issue_num}: ${full_title}"
    fi
    CREATED_ISSUES+=("$issue_num")
  done
done

echo ""
echo "✅ Test setup complete!"
echo "   ${#CREATED_ISSUES[@]} issues across ${SPRINTS} sprints"
echo ""
echo "▶ Start test run:"
echo "   npx tsx src/index.ts web --config sprint-runner.test.yaml"
echo ""
echo "🧹 Clean up when done:"
echo "   ./scripts/test-cleanup.sh"

#!/usr/bin/env bash
# scripts/e2e/reset.sh — Reset test project to baseline state
#
# Resets code to baseline tag, DELETES all GitHub issues, milestones, branches.
# This is a destructive operation — only run against the test project!

set -euo pipefail

REPO="trsdn/ai-scrum-test-project"
PROJECT_DIR="${1:-/Users/torstenmahr/dev/GitHub/ai-scrum-test-project}"

echo "🔄 E2E Reset: Cleaning $REPO"
echo ""

# --- 1. Reset code to baseline tag ---
echo "📦 Resetting code to baseline..."
cd "$PROJECT_DIR"
git fetch origin --tags --force 2>/dev/null || true
git checkout main 2>/dev/null
git reset --hard baseline
git clean -fd
echo "  ✅ Code reset to baseline tag"

# --- 2. Delete ALL issues (not just close) ---
echo ""
echo "🗑️  Deleting all issues..."
issue_count=0
while true; do
  numbers=$(gh issue list --repo "$REPO" --state all --json number -q '.[].number' --limit 50 2>/dev/null)
  [[ -z "$numbers" ]] && break
  for num in $numbers; do
    gh issue delete "$num" --repo "$REPO" --yes 2>/dev/null || true
    ((issue_count++)) || true
  done
done
echo "  ✅ Deleted $issue_count issues"

# --- 3. Delete ALL milestones ---
echo ""
echo "📋 Deleting milestones..."
ms_count=0
while true; do
  ms_numbers=$(gh api "repos/$REPO/milestones?state=all&per_page=50" -q '.[].number' 2>/dev/null)
  [[ -z "$ms_numbers" ]] && break
  for num in $ms_numbers; do
    gh api -X DELETE "repos/$REPO/milestones/$num" 2>/dev/null || true
    ((ms_count++)) || true
  done
done
echo "  ✅ Deleted $ms_count milestones"

# --- 4. Delete remote branches (except main) ---
echo ""
echo "🌿 Deleting remote branches..."
branch_count=0
for branch in $(git branch -r 2>/dev/null | grep -v 'HEAD' | grep -v 'main' | sed 's|origin/||'); do
  git push origin --delete "$branch" 2>/dev/null || true
  ((branch_count++)) || true
done
echo "  ✅ Deleted $branch_count branches"

# --- 5. Delete local branches (except main) ---
echo ""
echo "🌿 Deleting local branches..."
for branch in $(git branch 2>/dev/null | grep -v '^\*' | grep -v 'main'); do
  git branch -D "$branch" 2>/dev/null || true
done

# --- 6. Clean sprint artifacts ---
echo ""
echo "📄 Cleaning sprint artifacts..."
rm -f docs/sprints/*-state.json docs/sprints/*-state.json.lock docs/sprints/*-log.md
rm -f sprint-runner.log
# Reset velocity.md to empty
echo "| Sprint | Date | Goal | Planned | Done | Carry | Hours | Issues/Hr | Notes |" > docs/sprints/velocity.md
echo "|--------|------|------|---------|------|-------|-------|-----------|-------|" >> docs/sprints/velocity.md
echo "  ✅ Sprint artifacts cleaned"

# --- 7. Clean worktrees ---
echo ""
echo "🌲 Cleaning worktrees..."
worktree_base="../sprint-worktrees"
if [[ -d "$worktree_base" ]]; then
  for wt in "$worktree_base"/issue-*; do
    [[ -d "$wt" ]] && git worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt" 2>/dev/null || true
  done
fi
echo "  ✅ Worktrees cleaned"

# --- 8. Force push clean state ---
echo ""
echo "⬆️  Pushing clean state..."
git push origin main --force 2>/dev/null
echo "  ✅ Clean state pushed"

echo ""
echo "✅ Reset complete! Project is at baseline."

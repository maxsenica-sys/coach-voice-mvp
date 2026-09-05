#!/usr/bin/env bash
# product-review/context.sh
#
# The change-driven half of the review context. Prints a compact digest of what
# has moved in CoachVoice since the last saved report, so an agent can weight
# recently touched screens without reading the repository.
#
# Deliberately cheap: no file contents, only names, counts and commit subjects.
# Agents open individual files themselves when they need to check a claim.
#
#   bash product-review/context.sh

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

REPORTS_DIR="product-review/reports"

# The baseline is the commit that last touched the reports directory — i.e. the
# state of the app as of the previous review. First run has no baseline, so fall
# back to the last 10 commits.
BASE="$(git log -1 --format=%H -- "$REPORTS_DIR" 2>/dev/null || true)"

echo "# Change context — $(date +%Y-%m-%d)"
echo
echo "HEAD: $(git log -1 --format='%h %s' 2>/dev/null)"

LAST_REPORT="$(ls -1 "$REPORTS_DIR"/*.md 2>/dev/null | sort | tail -1 || true)"
if [ -n "$LAST_REPORT" ]; then
  echo "Previous report: $LAST_REPORT"
else
  echo "Previous report: none — this is the first review."
fi
echo

if [ -n "$BASE" ]; then
  RANGE="$BASE..HEAD"
  echo "## Commits since the last review ($RANGE)"
else
  RANGE=""
  echo "## Last 10 commits (no previous review to diff against)"
fi
echo

if [ -n "$RANGE" ]; then
  git log --format='- %h %ad %s' --date=short "$RANGE" 2>/dev/null | head -40
else
  git log --format='- %h %ad %s' --date=short -10 2>/dev/null
fi
echo

echo "## Files changed, by churn"
echo
if [ -n "$RANGE" ]; then
  git diff --stat "$RANGE" -- app lib supabase 2>/dev/null | tail -40
else
  git log --format= --name-only -10 -- app lib supabase 2>/dev/null \
    | grep -v '^$' | sort | uniq -c | sort -rn | head -25
fi
echo

echo "## Review coverage — reviews since each area was last the primary subject"
echo
echo "(Areas listed in REGISTER.md under 'Coverage'. Anything at 4+ is due an"
echo "unprompted audit even if nothing there has changed.)"

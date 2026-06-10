#!/usr/bin/env bash
# Batch-create GitHub issues for omp-flow v2 canon board.
# Run after `gh auth login`. Each issue body is in a .md file.
set -euo pipefail

REPO="opulate/omp-flow"
ISSUES_DIR="$(dirname "$0")"

declare -A TITLES
TITLES[01]="v2: State machine context extension (current_issue, issue_board_url, prd_summary)"
TITLES[02]="v2: Surgical edit pre-hook — block 'write' on existing files during IMPLEMENTING"
TITLES[03]="v2: Three new skills — grill-me, red-green-refactor, improve-codebase-architecture"
TITLES[04]="v2: Planner role update — grill-me, module map, GitHub issues, issue-set-as-artifact"
TITLES[05]="v2: Implementor role update — mandatory TDD via red-green-refactor, surgical edit discipline"
TITLES[06]="v2: Council role update — horizontal slice rejection, test quality check, diff scope signal"
TITLES[07]="v2: Workflow-protocol SKILL.md update — v2 planning flow, per-issue cycle, new skills"
TITLES[08]="v2: Slash command verify and extend — /workflow approve, /workflow reset docs"
TITLES[09]="v2: AGENTS.md and README update — new skills, GitHub issues, v2 descriptions"

for num in 01 02 03 04 05 06 07 08 09; do
  body_file="${ISSUES_DIR}/${num}-"*.md
  # Expand glob (there should be exactly one match)
  body_file=$(echo $body_file)
  if [[ ! -f "$body_file" ]]; then
    echo "ERROR: Missing body file for issue ${num}: $body_file"
    exit 1
  fi
  label="afk"
  echo "Creating issue #${num}: ${TITLES[$num]}"
  gh issue create \
    --repo "$REPO" \
    --title "${TITLES[$num]}" \
    --body-file "$body_file" \
    --label "$label"
done

echo ""
echo "All 9 issues created. Record the issue board URL and update state.json with issue_board_url."

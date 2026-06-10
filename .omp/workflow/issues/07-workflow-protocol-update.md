## Summary
Update the workflow-protocol SKILL.md to reflect v2 planning flow, per-issue cycle mechanics, new context fields, and new skill references.

## Scope
- `.omp/skills/workflow-protocol/SKILL.md`: Update to reflect:
  - Planning phase now includes: grill-me → module map → GitHub issue creation → Planner-Council review → seal
  - The sealed artifact at PLANNING → AWAITING_OPERATOR_APPROVAL is the GitHub issue set (not design doc)
  - Per-issue cycle: IMPLEMENTING → COUNCIL → VALIDATING → RETRO → MERGE loop runs once per issue, loops back for next unblocked issue
  - `current_issue` and `issue_board_url` are now part of state context
  - Reference the three new skills (grill-me, red-green-refactor, improve-codebase-architecture) and where each is invoked

## Test boundary
The workflow-protocol SKILL.md is the authoritative state machine reference — verify it accurately describes all states, transitions, and the new planning/issue flow.

## Out of scope
- Changing the state machine itself (states and transitions are unchanged)
- Adding new artifact keys (issue set is stored via issue_board_url in context, not as a sealed artifact)

## Acceptance criteria
- Planning section describes grill-me → module map → issues → Council review → seal flow
- Sealed artifact at PLANNING → APPROVAL documented as GitHub issue set with issue_board_url
- Per-issue cycle described: IMPLEMENTING → COUNCIL → VALIDATING → RETRO → MERGE per issue, loops
- `current_issue` and `issue_board_url` listed in state context description
- Three new skills referenced with invocation trigger points
- State machine transition table unchanged (same 10 states, 11 transitions)

## Blocked by
#1 (context fields must exist), #3 (skills must exist)

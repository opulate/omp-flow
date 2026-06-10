## Summary
Update the Planner role definition to reflect v2 protocol: grill-me alignment, improve-codebase-architecture scan, GitHub issue creation as canon board, and issue-set-as-sealed-artifact.

## Scope
- `.omp/agents/planner.md`: Add before-planning steps (grill-me → improve-codebase-architecture → module map). Replace design doc references with GitHub issue set. Add issue creation protocol: `gh issue create`, vertical slices, test_boundary in body, afk/hitl tags, blocking relationships. Update sealed artifact description: issue board URL recorded in state as `issue_board_url`. Update guard checklist to reflect new artifact key.

## Test boundary
The planner agent reads `.omp/agents/planner.md` to determine its protocol — correctness is verified by checking the file contains all required sections.

## Out of scope
- Changing the state machine (PLANNING → AWAITING_OPERATOR_APPROVAL transition is unchanged)
- Changing the Council sign-off flow (still required before transition)
- Updating other agents (separate issues)

## Acceptance criteria
- planner.md includes "before every new planning cycle" section with grill-me, improve-codebase-architecture, module map steps
- planner.md states issues are created via `gh issue create`, not local markdown files
- planner.md requires every issue be a vertical slice with a `test_boundary`
- planner.md requires afk or hitl tags on every issue
- planner.md states the sealed artifact at transition is the GitHub issue set, with `issue_board_url` in state
- Guard checklist updated: "design doc" references become "issue set"

## Blocked by
#3 (skills must exist before planner references them)

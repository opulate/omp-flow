## Summary
Verify that the `/workflow approve` and `/workflow reset` subcommands are fully documented and implemented, and fill any documentation gaps.

## Scope
- `.omp/commands/workflow.md`: Verify approve and reset subcommands are documented with correct syntax, valid states, and role restrictions. The Phase 3 implementation already supports both actions in `workflow_transition`. Confirm the documentation matches the implementation and extend if any detail is missing.

## Test boundary
The workflow command documentation is tested by an agent reading it and correctly invoking the subcommands — verify completeness against the `workflow_transition` tool implementation.

## Out of scope
- Implementing new subcommands (approve and reset are already implemented)
- Changing the workflow_transition tool behavior
- Backporting Phase 3 features

## Acceptance criteria
- `/workflow approve` documented: operator-only, records approval with audit trail, valid from AWAITING_OPERATOR_APPROVAL → IMPLEMENTING and AWAITING_MERGE → DONE
- `/workflow reset` documented: operator-only, from BLOCKED → previous_state (clears block_reason), from DONE → PLANNING (clears artifacts/approvals/findings)
- Both subcommands show the correct syntax and error conditions
- Documentation matches the implementation in `.omp/tools/workflow-transition/index.ts`

## Blocked by
none

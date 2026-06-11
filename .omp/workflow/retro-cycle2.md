# Retro — Cycle 2

## What worked
- writeState fix was a 1-line change — minimal diff, high impact
- TDD caught the import issue immediately
- Orchestrator role is pure documentation — no state machine changes needed

## What didn't
- State.json corruption during iterative testing required multiple manual fixes
- ApprovalRecord shape mismatch between tool output and isValidWorkflowContext — the tool writes `approved_by`/`approved_at` but validation expects `approved: boolean`. Pre-existing v2 bug surfacing now.

## Carry-forward
- ApprovalRecord mismatch should be fixed in the workflow_transition tool to include `approved: true`

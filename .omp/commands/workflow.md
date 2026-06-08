# /workflow

Workflow state machine control for omp-flow.

## Subcommands

### /workflow status

Read the current workflow state. Calls `workflow_status` tool and displays:
- Current state and previous state
- Feature branch and PR
- Sealed artifacts with timestamps
- Council sign-off and operator approval status
- Open findings (with P0/P1 count)

Alias: `/workflow`

### /workflow approve

Operator-only. Records operator approval in workflow state and advances the machine if the current state is `AWAITING_OPERATOR_APPROVAL`.

This is a manual operator action — agents cannot self-approve.

### /workflow reset

Operator-only. Resets the workflow state from `BLOCKED` back to the previous state, or from `ERROR` back to `PLANNING`.

### /workflow info

Display the full state machine reference: all states, valid transitions, and guard conditions.

## Phase 1 Scope

Only `/workflow status` is implemented in Phase 1. `approve` and `reset` are scheduled for Phase 2.

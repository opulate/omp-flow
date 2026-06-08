# /workflow

Workflow state machine control for omp-flow.

## Subcommands

### /workflow status

Read the current workflow state. Calls `workflow_status` tool and displays:
- Current state and previous state
- Feature branch and PR
- Block reason (if BLOCKED)
- Sealed artifacts with timestamps
- Council sign-off and operator approval status (with audit trail)
- Open findings (with severity and description)
- Next action guidance (first-run only)
- Last transition timestamp

Alias: `/workflow`

### /workflow approve

Operator-only. Records operator approval with audit trail (timestamp, identity, method) and advances the workflow:
- From `AWAITING_OPERATOR_APPROVAL` → `IMPLEMENTING`
- From `AWAITING_MERGE` → `DONE`
- Other states: returns error

Implementation: calls `workflow_transition(action="approve", role="Operator")`. Agents cannot self-approve — the role check enforces Operator-only access.

### /workflow reset

Operator-only. Resets the workflow from error states:
- From `BLOCKED` → `previous_state` (dynamically resolved from context)
- Other states: returns error
- Clears `block_reason`

Implementation: calls `workflow_transition(action="reset", role="Operator")`.

### /workflow info

Display the full state machine reference: all states, valid transitions, and guard conditions.

## Phase 2

All subcommands (`status`, `approve`, `reset`, `info`) are implemented. The `approve` and `reset` commands use structured `ApprovalRecord` with audit trail (approved_by, approved_at, method).

# /workflow

Workflow state machine control for omp-flow.

## Subcommands

### /workflow status


- Current state and previous state
- State history (last 3 transitions with timestamps and roles)
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

Operator-only. Resets the workflow from error/terminal states:
- From `BLOCKED` → `previous_state` (dynamically resolved from context)
- From `DONE` → `PLANNING` (clears artifacts, approvals, archives findings)
- Other states: returns error
- Clears `block_reason`

Implementation: calls `workflow_transition(action="reset", role="Operator")`.

### /workflow council-signoff

Planner-only. Records Council sign-off with audit trail. Only valid from `PLANNING` state.

Implementation: calls `workflow_transition(action="council_signoff", role="Planner")`.

### /workflow info

Display the full state machine reference: all states, valid transitions, and guard conditions.

## Phase 3

All subcommands are implemented. State history tracks every transition. DONE is resettable. Artifact preservation prevents partial-context writes. The `workflow_transition` tool uses `actor.send()` as the single mutation path — guards live exclusively in the XState machine.

## v2 Verified — approve and reset subcommands are complete and match the workflow_transition implementation.

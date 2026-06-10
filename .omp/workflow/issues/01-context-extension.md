## Summary
Add `current_issue`, `issue_board_url`, and `prd_summary` fields to the workflow state machine context, with forward-compatible migration in state persistence.

## Scope
- `src/state-machine/types.ts`: Add `current_issue: number | null`, `issue_board_url: string | null`, `prd_summary: string | null` to `WorkflowContext` interface and `createInitialContext()` factory
- `src/integrity/state-persistence.ts`: Add null defaults for new fields in `loadState()` so existing `state.json` files migrate forward without error
- `src/state-machine/machine.ts`: Verify initial context from `createInitialContext()` already provides null defaults (no structural change needed)

## Test boundary
`src/state-machine/smoke-test.ts` — existing smoke tests verify context round-trips through persistence; extend with assertions on new fields defaulting to null.

## Out of scope
- Wiring `issue_board_url` to actual GitHub API calls (that's a separate integration concern)
- Populating `prd_summary` from grill-me output (done by Planner at planning time)
- UI or display changes for workflow_status

## Acceptance criteria
- `WorkflowContext` interface includes `current_issue`, `issue_board_url`, `prd_summary` as nullable fields
- `createInitialContext()` returns all three fields as `null`
- `loadState()` handles state.json files missing these fields by defaulting to `null`
- Existing smoke tests pass without modification
- `bun run typecheck` passes

## Blocked by
none

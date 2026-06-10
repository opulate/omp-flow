## Summary
Extend the workflow-gate pre-hook to detect and warn/block `write` tool calls on existing files during IMPLEMENTING state, enforcing surgical edit discipline.

## Scope
- `.omp/hooks/pre/workflow-gate.ts`: In the IMPLEMENTING state block, add a check: if tool is `write` AND the target file exists on disk, emit structured warning on first occurrence, hard block on second occurrence in the same session. Track occurrence count in session memory (not state.json). Error message: "Surgical edit required. Use 'edit' with hashline anchors for existing files. 'write' replaces the entire file."

## Test boundary
Pre-hook blocking behavior: verify that a `write` call on an existing file during IMPLEMENTING is warned on first occurrence and blocked on second.

## Out of scope
- Tracking occurrence count across sessions (session memory only)
- Blocking `write` on new files (allowed — that's the correct tool for new files)
- Extending the hook for other states

## Acceptance criteria
- First `write` on existing file in IMPLEMENTING state returns a warning (block: false, but with a structured warning message)
- Second `write` on any existing file in IMPLEMENTING state returns a hard block (block: true) with the specified error message
- `write` on a new (non-existent) file is allowed
- `edit` and `ast_edit` calls are not affected (already allowed)
- Occurrence counter resets on session restart
- `bun run typecheck` passes

## Blocked by
none

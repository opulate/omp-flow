## Summary
Update the Implementor role definition to mandate TDD via red-green-refactor skill and enforce surgical edit discipline with tool-specific rules.

## Scope
- `.omp/agents/implementor.md`: Add mandatory TDD protocol section referencing `red-green-refactor` skill. Add surgical edit discipline: use `edit` with hashline anchors for existing files, `write` only for new files, state minimum diff before each change. Reference the workflow-gate pre-hook that blocks `write` on existing files during IMPLEMENTING.

## Test boundary
The implementor agent reads `.omp/agents/implementor.md` for its protocol — verify the file contains TDD and surgical edit requirements.

## Out of scope
- Implementing the pre-hook (separate issue #2)
- Implementing the red-green-refactor skill (separate issue #3)
- Adding new tools or changing existing tool behavior

## Acceptance criteria
- implementor.md mandates invoking `red-green-refactor` skill at start of every implementation cycle
- implementor.md states: write failing test → confirm red → implement → confirm green (`bun test && bun run typecheck`) → seal
- implementor.md states both test and typecheck must pass before `artifact_seal` on impl-complete
- implementor.md states: use `edit` with hashline anchors for existing files, `write` for new files only
- implementor.md warns: `write` on existing file during IMPLEMENTING triggers pre-hook warning then block

## Blocked by
#3 (red-green-refactor skill must exist)

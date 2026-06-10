# Retro — omp-flow v2

## Cycle Summary
Planning → Implementation → Council → Validation for the v2 desired state delta (9 issues + 1 new Orchestrator issue).

## What Worked
- **Issue-as-canon-board**: GitHub issues (#1-#9) provided clear, independently scoped work units with blocking relationships. Phase 1 parallel execution (#1,#2,#3,#6,#8) was efficient.
- **TDD on context extension**: Writing failing test assertions first, confirming typecheck failure, then implementing — clean red-green flow despite not having the formal skill file yet.
- **Parallel subagents for documentation**: 5 doc updates in parallel via task subagents completed in ~1 minute vs sequential editing.
- **Council review caught a real P1**: planner.md artifact key mismatch would have broken the Planner workflow. Caught and fixed before validation.
- **State machine unchanged**: 10 states, 11 transitions survived v2 without modification — good architecture.

## What Didn't
- **Edit tool duplication**: Several edits produced duplicate lines (council_sign_off, block_reason, writeFileSync, closing braces). Required manual cleanup. The replace range semantics need care.
- **GitHub auth gap**: Issues couldn't be created until operator provided `gh` credentials mid-implementation. The `create-issues.sh` script was needed as a fallback.
- **Todo system bug**: Issue #7 was prematurely marked done by the todo system, requiring manual tracking.
- **Contract scope gap**: `smoke-test.ts` wasn't in the validation contract scope despite the contract requiring new tests. The contract should have included it.

## Carry-Forward Risks
- **Orchestrator role (#10)**: New issue scoped but not implemented. Will require state machine review — auto-advancing may need new events or a meta-orchestrator outside the machine.
- **Artifact key `design-doc` remains**: Guard still checks `design-doc` but v2 semantics changed to "issue set." Future cycle may want to rename the key.
- **Session memory for pre-hook**: `writeOnExistingFileCount` resets on harness restart. Long-running sessions may never reset. Consider time-based decay or explicit reset mechanism.

## Recommendations
- Add smoke-test.ts to validation contract scopes by default (any change touching types/persistence/machine likely touches the test)
- Fix todo system bug (prematurely marking non-done tasks)
- Consider `issue_board_url` auto-population from `gh issue list` output

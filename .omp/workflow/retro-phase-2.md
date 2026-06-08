# Retrospective — Phase 2

**Date:** 2026-06-08
**Cycle:** Structured Contracts & Operator Controls

## What Worked

1. **Structured contract enforcement works.** `validateContractStructure()` correctly rejects free-text, globstars, catch-alls, and empty scopes. The ` ```json ` fence requirement (after P1-4 fix) is clear and unambiguous. Council re-review confirmed the guard is called in both the approve action and the regular transition path.

2. **Approval audit trail is solid.** `ApprovalRecord` with `approved_by`/`approved_at`/`method` provides clear traceability. The v1→v2 migration in `loadState()` handles backward compatibility cleanly. Smoke tests verify distinct messages for null/pending, denied, and approved states.

3. **Slash command suite complete.** `/workflow approve` and `/workflow reset` are operational with proper role enforcement (Operator-only). The P0 fixes closed the guard bypass holes that the Council identified.

4. **Workflow status improvements are useful.** `findings_open[]` in the details output lets agents see findings without parsing text. `next_action` guidance reduces ambiguity for first-run scenarios. ApprovalRecord display shows who approved, when, and how.

5. **Council review process caught real bugs.** The P0 findings (approve bypass, BLOCKED bypass) were genuine enforcement gaps that smoke tests didn't catch because tests used the machine path while the tool takes a different code path. Council identified these within minutes.

6. **106 smoke tests, zero failures.** Test coverage expanded from 49 to 106 assertions covering all Phase 2 features plus Phase 1 regression.

## What Didn't Work

1. **Artifact persistence is fragile.** State artifacts (design-doc, validation-contract) are repeatedly lost during transitions. Every `writeState()` call writes the exact context it's given — if that context was loaded from a state that already lost artifacts, the loss propagates. This happened 3+ times during this cycle: the initial v2 migration, council transitions, and validation transition. The `backupCorruptedState()` mechanism only fires on corruption, not on intentional writes with incomplete context.

2. **Two code paths, two realities.** The XState machine has one set of guard enforcement, and the `workflow_transition` tool has another. The tool bypasses the machine for state writes (direct `ctx.state = target`), meaning machine-level `assign()` actions don't fire and guards must be duplicated in the tool. This caused both P0 findings — the machine's guards blocked correctly, but the tool's code path didn't call them.

3. **Scope declaration missed a file.** `src/integrity/hash.ts` was modified (new `computeHashWithContent` function) but wasn't declared in the contract scope. The Planner listed `state-persistence.ts` but not its sibling `hash.ts`. The function was necessary for the implementation to read contract content — it's an infrastructure dependency the Planner didn't anticipate.

4. **Council sign-off has no tool.** `SET_COUNCIL_SIGN_OFF` exists in the machine's event types but has no corresponding tool or slash command. The Planner must directly edit `state.json`. This was missed in Phase 1 and wasn't in Phase 2's scope, but it's a gap that every planning cycle hits.

## Carry-Forward Risks

1. **Artifact loss will recur in Phase 3.** Any transition that rewrites state.json will drop artifacts unless the caller explicitly preserves them. Mitigation: Phase 3 should add artifact preservation to `writeState()` — either validate that required artifacts exist before writing, or make transitions use `loadState()` → modify → `writeState()` as the only pattern.

2. **Tool/machine divergence is a recurring bug surface.** Every guard added in the future should be checked against both code paths. Current risk: 2 code paths × N guards = 2N potential bypasses. Mitigation: Phase 3 should refactor to use `actor.send()` as the single state mutation path, with the tool reading the resulting snapshot.

3. **Contract scope precision remains Planner-dependent.** The Validator caught a scope miss on `hash.ts`. No machine enforcement prevents underspecified scopes — the contract's `scope.files` is checked for format (no globstars) but not for completeness against actual changes. Mitigation: Phase 3 could add a `git diff` check that warns when changed files don't match contract scope.

4. **`previous_state` tracking is unreliable.** The `previous_state` field is overwritten on every transition. If a transition passes through BLOCKED → RESET, the original previous_state (before the block) is lost — replaced by "BLOCKED". This means you can't trace the full transition history. Mitigation: Phase 3 could add a `state_history` array.

5. **P2 finding remains open.** `hash.ts` scope miss (P2) is not blocking but should be resolved before Phase 3 planning. Adding it to the contract or noting it as accepted deviation.

## Transition

Ready for operator merge review. All functional assertions pass, structured contract enforcement is in place, and the known weaknesses are documented for Phase 3.

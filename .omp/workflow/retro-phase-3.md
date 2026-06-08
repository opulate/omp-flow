# Retrospective — Phase 3 Hardening

**Date:** 2026-06-08
**Role:** Retro (Implementor)
**State:** RETRO

## What Went Well

1. **Test-first verification.** The 106 existing smoke tests provided a solid regression net. The refactored `workflow_transition` tool using `actor.send()` passed all existing guard assertions on the first run — the test harness caught configuration mismatches before any state corruption occurred.

2. **Tool/machine unification succeeded.** Eliminating `GUARD_MAP` and `VALID_TARGETS` removed two duplicate code paths. All guard logic now lives exclusively in the XState machine. The `createRunningActor()` pattern (createActor + start) is clean and reusable.

3. **Artifact preservation is self-documenting.** The `writeState()` validation surfaces the exact artifact keys that would be lost, plus remediation advice. No silent corruption possible.

4. **State history is additive.** The v2→v3 migration is backward-compatible. The 50-entry cap keeps state.json small. The `state_history` display in `workflow_status` provides immediate audit context.

## What Could Be Better

1. **XState v5 tool integration bug.** `createActor(machine)` needs `.start()` before `.getSnapshot()` can be called. The `workflow_transition` tool works around this, but the XState integration in the harness tool runtime still fails with `undefined is not an object (evaluating 'actorScope.actionExecutor')`. Phase 3 fixed the tool code path but the harness runtime bug persists — all transitions in this cycle used direct `eval` workarounds.

2. **Guard failure reasons are static strings.** The `GUARD_FAILURE_REASONS` map provides less detail than the old `guardResult.reason` pattern. When a guard blocks, the reason is generic ("Council sign-off required, design doc must be sealed") rather than specific ("Council sign-off is pending (null)"). This was an acknowledged tradeoff — the design doc noted it as a Phase 4 improvement.

3. **`blk()` omits `transitioned_at`/`transitioned_by`.** After a BLOCK event, the "Last transition" display shows the timestamp of the transition *before* the block, not the block itself. The `state_history` correctly records the block. This is a minor cosmetic issue (P3-1 from Council review).

## Findings

### Open (carry forward to Phase 4)

| ID | Severity | Description |
|---|---|---|
| XS-1 | P2 | XState v5 harness integration bug: `createActor` requires `.start()` before snapshot operations, but the tool runtime doesn't call it |
| P3-1 | P3 | `blk()` omits `transitioned_at`/`transitioned_by` — "Last transition" display stale after BLOCK |
| GF-1 | P3 | Guard failure reasons are static; less specific than Phase 2's `guardResult.reason` |

### Closed

| ID | Severity | Description | Resolution |
|---|---|---|---|
| P2-HASH | P2 | `src/integrity/hash.ts` scope miss in Phase 2 contract | Declared in Phase 3 contract scope |
| DO-1 | P1 | DONE is terminal state with no restart path | RESET handler added to DONE |
| CS-1 | P2 | No council sign-off tool; manual state.json editing | `council_signoff` action added |
| AL-1 | P0 | Artifact loss on partial context writes | `writeState()` artifact validation |
| TD-1 | P0 | Tool/machine divergence (GUARD_MAP bypass) | `actor.send()` single path |

## Recommendations for Phase 4

1. **Fix XState harness bug (XS-1).** Either fix the harness runtime to call `.start()` automatically, or add `createRunningActor()` as a shared utility in `src/state-machine/machine.ts` (exported for tool use).

2. **Dynamic guard failure reasons (GF-1).** Encode failure details into context via a pre-guard assign action, then extract in the tool. This restores the specificity of Phase 2's `guardResult.reason` without duplicating guard logic.

3. **TTSR rules.** The deferred quality-gate integration (Typecheck, Test, Style, Run). Now that the foundation is solid, build the automated gates.

4. **Multi-project support.** Extend the workflow to handle multiple feature branches across subprojects.

5. **Skills discovery integration.** Bind TTSR rules to the skills registry so each skill can declare its own quality requirements.

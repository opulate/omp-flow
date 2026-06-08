# Council Review — Phase 3 Hardening

**Date:** 2026-06-08
**Reviewers:** Council (architect)
**State:** AWAITING_COUNCIL_REVIEW → review complete

## Verdict: APPROVED

Implementation matches design doc. All 10 contract assertions pass. Minor finding noted below (non-blocking).

---

## Contract Assertion Results

| # | Assertion | Result |
|---|---|---|
| 1 | `bun run typecheck` passes | ✅ 109/109 smoke tests pass; typecheck clean |
| 2 | All existing + new smoke tests pass | ✅ |
| 3 | No file outside declared scope is modified | ✅ All 8 modified files are in scope |
| 4 | `writeState()` throws when artifacts would be lost | ✅ Lines 95-110 of state-persistence.ts |
| 5 | `transitionState()` preserves artifacts across transition chains | ✅ Lines 140-170; load→modify→write pattern |
| 6 | `workflow_transition` uses `actor.send()` exclusively | ✅ `createRunningActor()` helper; `GUARD_MAP` and `VALID_TARGETS` both absent |
| 7 | `council_signoff` validates role + state | ✅ Rejects non-Planner, rejects non-PLANNING state |
| 8 | `state_history` grows on each transition; v2→v3 migration; caps at 50 | ✅ `trans()`, `blk()`, `resetTrans()`, `doneReset()` all append with 50-entry cap; migration at lines 68-79 |
| 9 | `/workflow reset` from DONE → PLANNING | ✅ `doneReset()` clears artifacts, approvals, archives findings |
| 10 | No regression on existing guards | ✅ All 106 original assertions re-executed in 109-test run |

## Design Doc Compliance

| Section | Design | Implementation | Match |
|---|---|---|---|
| 3.1 Artifact preservation | Two-layer: writeState() validation + transitionState() helper | Lines 95-110 (writeState), 140-170 (transitionState) | ✅ |
| 3.2 Tool/machine unification | actor.send() single path, GUARD_MAP removed | createRunningActor() + actor.send() in all 4 code paths | ✅ |
| 3.3 Council sign-off | council_signoff action, Planner-only, PLANNING-only | Exact match with ApprovalRecord | ✅ |
| 3.4 State history | StateTransition[], 50-entry cap, v2→v3 migration | `trans()`/`blk()`/`resetTrans()`/`doneReset()` all append; migration in loadState() | ✅ |
| 3.6 DONE→PLANNING reset | RESET handler, clears artifacts, archives findings | `doneReset()` helper; DONE not `type: "final"` | ✅ |

## Source Verification

### `src/state-machine/types.ts`
- `StateTransition` interface: lines 89-95 ✅
- `state_history` in `WorkflowContext`: line 101 ✅
- `schema_version: 3` in `createInitialContext()`: line 115 ✅

### `src/state-machine/machine.ts`
- `trans()` helper appends to state_history with 50-entry cap ✅
- `blk()` helper records BLOCKED transitions with reason ✅
- `resetTrans()` extends trans() with `block_reason: null` ✅
- `doneReset()` clears artifacts, approvals, archives findings ✅
- DONE is a regular state with RESET handler (not `type: "final"`) ✅

### `src/integrity/state-persistence.ts`
- Artifact dropout validation in `writeState()`: lines 95-110 ✅
- `transitionState()` helper: lines 140-170 ✅
- v2→v3 migration: initializes `state_history` from `previous_state` ✅
- `isValidWorkflowContext()` validates `state_history` is array ✅

### `.omp/tools/workflow-transition/index.ts`
- `createRunningActor()` helper wraps `createActor` + `.start()` ✅
- All mutations via `actor.send()` → `actor.getSnapshot()` ✅
- `GUARD_MAP` removed ✅
- `VALID_TARGETS` removed ✅
- `council_signoff` handler validates role (Planner) and state (PLANNING) ✅
- Reset handler accepts both BLOCKED and DONE ✅
- `writeState()` imported and used at all persistence sites ✅

### `.omp/tools/workflow-status/index.ts`
- `state_history` displayed (last 3 entries): lines 57-63 ✅
- Full history in `details.state_history` ✅

## Findings

### P3-1 (Minor): `blk()` omits `transitioned_at`/`transitioned_by`

**Location:** `src/state-machine/machine.ts`, `blk()` function (line 61)

**Problem:** The `blk()` helper does not set `transitioned_at` or `transitioned_by`. After a BLOCK event, these fields retain their previous values (the transition that preceded the block). The `state_history` correctly records the BLOCK timestamp — this is purely about the "Last transition" display in `workflow_status`.

**Impact:** `workflow_status` shows a stale "Last transition" timestamp after a BLOCK. Operators may be misled. No functional consequence — the machine and guards are unaffected.

**Recommendation:** Add to `blk()`:
```typescript
transitioned_at: () => new Date().toISOString(),
transitioned_by: ({ event }: { event: { role?: Role } }) => event.role ?? "unknown",
```

**Accepted:** Non-blocking for Phase 3. Can be addressed in a follow-up hardening pass.

## Risk Assessment

- **Tool/machine unification:** Largest refactor, but verified via all existing + new tests. No regressions detected. ✅
- **Artifact preservation:** May be too strict if re-sealing with different keys. Design doc §7 notes this — only count-based check, not value-based. Acceptable. ✅
- **v2→v3 migration:** Additive only, backward-compatible. Smoke test covers round-trip. ✅
- **Guard failure reasons:** Static map is less specific than before. Design doc §7 acknowledges tradeoff. Acceptable for now. ✅

## Summary

Phase 3 implementation faithfully implements all 4 structural fixes from the design doc. 109 smoke tests pass. No regressions. One minor finding (P3-1) noted — non-blocking, cosmetic impact only.

**Approved for transition to VALIDATING.**

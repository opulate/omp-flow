# Council Review — Recursive #2: Reviewing the Meta-Review

**Date:** 2026-06-08
**Reviewer:** Council (second recursive pass)
**Scope:** Are the findings in Recursive Review #1 correct?

## Finding-by-finding verification

### P2 — BLOCKED no exit path ✓ CONFIRMED

Verified. `VALID_TARGETS["BLOCKED"]` is `[]`. Trace through tool `execute()`:
- Line 96: `currentState = "BLOCKED"`
- Line 99: `validTargets = []`
- Line 100: `!validTargets.includes(target)` — always true for any target
- Returns "Invalid transition" error

The tool only handles the `target === "BLOCKED"` case (entering BLOCKED), never leaving it. The machine's RESET event is unreachable through the tool since the tool only sends TRANSITION events.

**Severity confirmed:** P2. Workaround exists (hand-edit state.json). Fix is straightforward: add handler for exiting BLOCKED.

---

### P2 — Missing test coverage ✓ CONFIRMED

Verified. Smoke test exercises:
- `guardPlanningToAwaitingApproval` — hash match/mismatch ✓
- `guardAwaitingApprovalToImplementing` — various states ✓
- `guardImplementingToAwaitingCouncil` — feature branch/main ✓
- `guardAwaitingCouncilToValidating` — P0 findings open/resolved ✓
- `guardValidatingToRetro` — report exists/missing ✓

Not tested:
- `guardAwaitingCouncilToValidating` — hash mismatch after fix (test 4l creates file but doesn't modify it after sealing)
- `guardRetroToAwaitingMerge` — not tested at all
- `guardAwaitingMergeToDone` — not tested at all
- `guardBlockedToPrevious` — not tested at all

**Severity confirmed:** P2. The two newly-fixed guards (council→validating, retro→merge) have no hash-mismatch tests.

---

### P3 — artifact_seal silent overwrite ✓ CONFIRMED

Verified. `ctx.artifacts[params.key] = { ... }` is a direct assignment. No check for existing key. If "design-doc" is sealed twice, the first seal record is permanently lost.

However, this is arguably correct behavior — re-sealing IS the intended operation when an artifact is updated. A warning in the response would be sufficient.

**Severity confirmed:** P3. Low impact, easy fix.

---

### P3 — artifact_verify stale description ✓ CONFIRMED

Verified. Line 21 says "(used if key not found)" but line 28 uses `stored?.path ?? params.path` which means stored path is preferred. The description is wrong.

**Severity confirmed:** P3. One-line text fix.

---

### P3 — TOCTOU race ✓ CONFIRMED (but downgrade to P3)

Verified. Two concurrent `workflow_transition` calls both read state.json, both evaluate guards, both pass, both write. Last write wins.

However: omp's task subagents are workspace-isolated when `iso: true` (default for git-worktree mode). In the common case, only one agent operates on the state file. The race requires:
1. Non-isolated subagents (iso: false), AND
2. Both subagents transitioning simultaneously

This is an unlikely collision in practice. Severity stays P3.

---

### P3 — canResetFromBlocked guard vs machine target mismatch ✓ CONFIRMED

Verified. Machine line 294-295:
```ts
guard: { type: "canResetFromBlocked" },  // checks ctx.previous_state != null
target: "PLANNING",                       // ignores ctx.previous_state
```

The guard's only check is `!ctx.previous_state` → `{ allowed: false }`. But the machine doesn't use `previous_state` as the target — it always goes to PLANNING. The guard rejects resets when `previous_state` is null, but this is redundant since `previous_state` is always set by any prior transition.

**Severity confirmed:** P3. Cosmetic dead check. Could remove the guard or add a comment.

---

## New finding discovered during verification

### P3 — workflow_status doesn't reflect BLOCKED reason

**File:** `.omp/tools/workflow-status/index.ts`

When the workflow is BLOCKED, the status shows `State: BLOCKED` but doesn't surface WHY. The BLOCK transition records a `reason` in the event but the context has no `blocked_reason` field. The operator sees the state but not the cause.

**Fix:** Add `blocked_reason` field to `WorkflowContext`, populate on BLOCK transition, display in status.

---

## Summary

| Finding from R#1 | Verified? |
|---|---|
| P2: BLOCKED no exit path | ✓ Confirmed |
| P2: Missing test coverage | ✓ Confirmed |
| P3: artifact_seal silent overwrite | ✓ Confirmed |
| P3: artifact_verify stale description | ✓ Confirmed |
| P3: TOCTOU race | ✓ Confirmed (P3 stands) |
| P3: unused guard on BLOCKED RESET | ✓ Confirmed |

One new P3 found during verification (BLOCKED reason not surfaced).

## Verdict

**CLEAR** — Recursive Review #1 findings are all accurate. No false positives. One additional P3 found. No P0/P1 regressions.

# Council Review — Recursive #1: Meta-Review of the Deep Review

**Date:** 2026-06-08
**Reviewer:** Council (recursive pass)
**Scope:** What did the 2026-06-08 deep review miss?

## P2 — BLOCKED state has no exit path through workflow_transition

**File:** `.omp/tools/workflow-transition/index.ts:68`

```ts
BLOCKED: [], // Reset handled separately
```

`VALID_TARGETS["BLOCKED"]` is empty. The tool's `execute()` function checks `validTargets.includes(target)` at line 100 and rejects everything. The comment says "Reset handled separately" but there is no separate RESET handler in the tool.

This means once any→BLOCKED transition fires, the only way out is to hand-edit `.omp/workflow/state.json`. The XState machine has a RESET event on BLOCKED (targeting PLANNING), but the tool never sends RESET events — it only sends TRANSITION events.

**Trigger:** Workflow enters BLOCKED. Operator tries `/workflow reset` or `workflow_transition(RESET)`. Tool rejects with "Invalid transition from BLOCKED to ...".

**Fix:** Add a RESET handler in the tool that targets `BLOCKED` → `ctx.previous_state ?? "PLANNING"`, or add `ctx.previous_state` to VALID_TARGETS for BLOCKED.

---

## P2 — Smoke tests don't cover new hash verification paths

**File:** `src/state-machine/smoke-test.ts`

Tests 4l and 4m exercise `guardAwaitingCouncilToValidating` but don't test hash mismatch. The guard now has 4 possible failure modes: no artifact, no hash, file missing, hash mismatch. Only "no artifact" and "open findings" are tested. The hash verification path is untested.

Similarly, no tests exist for `guardRetroToAwaitingMerge` at all — the smoke test never exercises this guard.

**Trigger:** A regression in hash verification wouldn't be caught by existing tests.

**Fix:** Add hash mismatch tests for both guards. Add retro→merge tests.

---

## P3 — artifact_seal silently overwrites existing artifacts

**File:** `.omp/tools/artifact-seal/index.ts:42-47`

```ts
ctx.artifacts[params.key] = { ... };
```

If an artifact with the same key already exists, it's silently replaced. No warning, no audit trail, no "previous hash" field. Re-sealing is a valid operation (e.g., after modifying and re-sealing a design doc), but the tool should at minimum warn that a previous seal is being overwritten.

**Trigger:** Agent accidentally re-seals "design-doc" with a different file — old hash lost permanently.

**Fix:** If `ctx.artifacts[params.key]` already exists, include the previous hash and sealed_at in the response details. Consider adding `previous_hash` to the artifact record.

---

## P3 — artifact_verify parameter description is now misleading

**File:** `.omp/tools/artifact-verify/index.ts:21`

```ts
path: pi.zod.string().describe("Path to the file to verify (used if key not found)"),
```

After the P2 fix, the tool uses `stored?.path` when the key exists, falling back to `params.path` only when the key is not found. The description says the opposite ("used if key not found"). The agent reading this description would think it needs to pass the path even when the key exists.

**Fix:** Update to `"Path to the file to verify. Defaults to the stored path when the key is found."`

---

## P3 — TOCTOU race on concurrent workflow_transition calls

**File:** `.omp/tools/workflow-transition/index.ts`

Two concurrent calls read state, evaluate guards, both pass, both write. The second write silently clobbers the first. For a single-agent harness this is fine, but subagents spawned via `task` could collide.

**Trigger:** Two subagents call `workflow_transition` concurrently — one transition is lost.

**Fix:** Add optimistic locking: store a `version` counter in state, increment on write, reject writes with stale version.

---

## P3 — Machine's canResetFromBlocked guard checks previous_state but machine ignores it

**File:** `src/state-machine/machine.ts:294-301`

```ts
RESET: {
  guard: { type: "canResetFromBlocked" },
  target: "PLANNING",  // ← always PLANNING, never previous_state
```

The guard `guardBlockedToPrevious` returns false if `!ctx.previous_state`. But the machine always transitions to PLANNING regardless. The guard checks a condition the transition doesn't use. Either:
- The guard should be removed (if BLOCKED→PLANNING is always valid), or
- The machine should target `previous_state` (if the guard is meaningful)

**Fix:** Remove the guard from this transition, or add a comment explaining the simplification. The guard's purpose (ensure previous_state exists before reset) is already served by the RESET being operator-only — the operator knows where they came from.

---

## Summary

| Severity | Count | Description |
|---|---|---|
| P2 | 2 | BLOCKED no exit path, missing test coverage |
| P3 | 4 | Silent overwrite, stale description, TOCTOU race, unused guard |

## Verdict

**CLEAR** — No P0 or P1 findings. The deep review caught all critical issues. Two P2s (BLOCKED exit, test gaps) should be addressed. Four P3s are cosmetic or edge-case.

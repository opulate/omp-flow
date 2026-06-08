# Council Review — Deep Review of Phase 1 Implementation

**Date:** 2026-06-08
**Reviewer:** Council (second-pass, full source read)
**Artifacts verified:** design-doc ✓, impl-complete ✓, validation-contract ✓

## P0 — workflow_transition crashes on XState machine advancement

**File:** `.omp/tools/workflow-transition/index.ts:179-180`

```ts
const machine = createWorkflowMachine(ctx);
const snapshot = machine.getInitialSnapshot(); // ← throws at runtime
```

`getInitialSnapshot()` requires an actor context in XState v5. Calling it on a bare machine throws:
```
TypeError: undefined is not an object (evaluating 'actorScope.actionExecutor')
```

The state IS written to disk before this line (line 174), so data integrity is preserved, but every transition returns a crash instead of a success response. The agent sees an error.

**Trigger:** Any successful `workflow_transition` call. 100% reproducible.

**Fix:** Use `createActor(machine).getSnapshot()` (already the pattern used in smoke-test.ts). Import `createActor` from `xstate`.

---

## P1 — Council-report hash not verified at COUNCIL → VALIDATING gate

**File:** `src/state-machine/guards.ts:159-190`

`guardAwaitingCouncilToValidating` checks that `ctx.artifacts["council-report"]` exists, but never calls `computeHash()` on the report file. The Council could modify the report after sealing and the gate would pass.

Compare against `guardValidatingToRetro` (line 213-235) which correctly calls `computeHash(reportArtifact.path)` and compares against `reportArtifact.hash`.

**Trigger:** Council seals report, edits it afterward, transitions to VALIDATING — gate passes despite tampered artifact.

**Fix:** Add hash verification matching the pattern in `guardValidatingToRetro`.

---

## P1 — Retro-doc hash not verified at RETRO → AWAITING_MERGE gate

**File:** `src/state-machine/guards.ts:255-261`

`guardRetroToAwaitingMerge` checks that `ctx.artifacts["retro-doc"]` exists, but never calls `computeHash()` on the retro file.

Three of seven guards verify hashes. Two skip it. The inconsistency means half the artifact integrity model is aspirational.

**Trigger:** Retro doc sealed then modified — gate passes.

**Fix:** Add hash verification matching the pattern in `guardValidatingToRetro`.

---

## P2 — `writeState` uses cross-filesystem temp file

**File:** `src/integrity/state-persistence.ts:50-52`

```ts
const tmp = resolve(tmpdir(), `omp-workflow-state-${randomUUID()}.json`);
writeFileSync(tmp, json, "utf-8");
renameSync(tmp, STATE_PATH);
```

`renameSync` across filesystems fails. `tmpdir()` may be on a different mount than the project (common in containerized environments and some Linux distros). The atomitity guarantee breaks.

**Trigger:** Project on a different filesystem from `os.tmpdir()` — `renameSync` throws `EXDEV`.

**Fix:** Write the temp file to the same directory as the target: `resolve(dirname(STATE_PATH), '.state-tmp-' + randomUUID())`.

---

## P2 — Hook doesn't block `bash` during review/validation states

**File:** `.omp/hooks/pre/workflow-gate.ts:15-18`

```ts
const MODIFYING_TOOLS = new Set(["write", "edit", "ast_edit"]);
```

`bash` can modify files (sed, rm, mv, redirects) but is not blocked during AWAITING_COUNCIL_REVIEW or VALIDATING. This was noted in the first Council review as a P2 but not addressed.

**Trigger:** Agent runs `bash` with destructive commands during review/validation — modifies code while Council/Validator is evaluating it.

**Fix:** Add `bash` to MODIFYING_TOOLS for AWAITING_COUNCIL_REVIEW and VALIDATING states. Allow it during IMPLEMENTING (only main-branch ops blocked). During BLOCKED, it's already blocked by the catch-all.

---

## P2 — `artifact_verify` ignores stored path

**File:** `.omp/tools/artifact-verify/index.ts:24-28`

The `path` parameter description says "used if key not found," but the code always computes the hash of `params.path` regardless of whether the key has a stored path. If the artifact was sealed at path A but the agent passes path B, the comparison is hash(B) vs stored_hash(A) — which correctly fails, but with a misleading error. The tool should use the stored path when the key exists.

**Trigger:** Agent calls `artifact_verify(key="design-doc", path="wrong/path.md")` — gets hash mismatch instead of "wrong path" error.

**Fix:** Use `stored.path` when the key exists, fall back to `params.path` only when key not found.

---

## P3 — Dead code: `guardToBlocked` never called

**File:** `src/state-machine/guards.ts:284-286`, `.omp/tools/workflow-transition/index.ts:118`

The tool's BLOCKED handler (line 118) short-circuits without calling `guardToBlocked`. The guard function is defined and imported into `machine.ts` but never exercised because the BLOCKED transition bypasses all guard evaluation in the tool.

**Trigger:** N/A — dead code, no functional impact.

**Fix:** Either remove `guardToBlocked` or call it in the BLOCKED handler before allowing the transition.

---

## P3 — Double state write in workflow_transition tool

**File:** `.omp/tools/workflow-transition/index.ts:174,189`

State is written at line 174 (after manual transition), then again at line 189 (after XState machine advancement). The second write overwrites the first. If the machine advancement produces different context than the manual transition, the tool's own state change could be silently altered. Currently the machine advancement crashes (P0), so the second write never executes — but once the P0 is fixed, this becomes a correctness concern.

**Fix:** Remove the first write (line 174) and only write after the machine advancement, or remove the machine advancement entirely (the tool already handles transitions manually).

---

## Summary

| Severity | Count | Description |
|---|---|---|
| P0 | 1 | workflow_transition crashes on getInitialSnapshot |
| P1 | 2 | Council-report and retro-doc hash verification missing |
| P2 | 3 | Cross-fs temp file, bash not blocked, verify ignores stored path |
| P3 | 2 | Dead guardToBlocked code, double state write |

## Verdict

**RETURN FOR REWORK** — P0 is a hard blocker. Every transition crashes. P1 findings are integrity gaps in the artifact model (two of seven guards skip hash verification). P2s should be addressed in this phase since they're small fixes. P3s are cosmetic.

Recommend: fix P0 first (one-line change + import), then P1s (add hash verification to two guards), then P2s.

# Phase 3 Design Doc — Hardening

**Feature:** Fix structural weaknesses identified in Phase 2 retro: artifact preservation, tool/machine unification, council sign-off tool, and state history.
**Status:** Draft (pre-approval)
**Date:** 2026-06-08

## 1. Problem Statement

Phase 2 delivered structured contracts, full slash commands, and ApprovalRecord audit trail. It works — but the Phase 2 retro identified four structural weaknesses that caused real bugs (two P0 findings) and operational friction:

1. **Artifact loss on transition.** Artifacts (design-doc, validation-contract, etc.) are repeatedly lost when `writeState()` is called with incomplete context. The tool uses `loadState()` → modify → `writeState()`, but nothing prevents a caller from constructing a partial context. Defense in depth is missing.

2. **Tool/machine divergence causes bypasses.** The `workflow_transition` tool duplicates guard evaluation in `GUARD_MAP` and mutates state directly (`ctx.state = target`), bypassing XState's transition logic entirely. This caused both Phase 2 P0 findings: the approve bypass (guard not called) and the BLOCKED bypass (code path skipped machine-level guard). Every new guard added risks another duplicate.

3. **Council sign-off has no tool.** `SET_COUNCIL_SIGN_OFF` exists in the XState machine event types and has an `assign()` action, but there is no tool, slash command, or documented mechanism to invoke it. The Planner must manually edit `state.json` — a gap hit in every planning cycle.

4. **State history is single-deep.** `previous_state` is overwritten on every transition, erasing the trace through BLOCKED → RESET chains. If a transition goes `IMPLEMENTING → BLOCKED → VALIDATING`, the original `IMPLEMENTING` state is gone — you only see `BLOCKED`. Audit and debugging suffer.

**Why fix now:** These are not feature requests. They are structural flaws that caused real bugs in Phase 2 (two P0 findings) and caused operational friction (3+ artifact losses, manual state.json editing for council sign-off). Phase 3+ features (TTSR rules, multi-project, skills discovery) will be built on this foundation — fixing the foundation first reduces risk for everything that follows.

## 2. Scope (Phase 3)

### In Scope
- **Artifact preservation** — `writeState()` validates that in-flight artifacts exist before overwriting state.json; transitions use a single `loadState()` → modify → `writeState()` call chain tracked by a helper that makes partial-context bugs visible
- **Tool/machine unification** — refactor `workflow_transition` to use `actor.send()` as the single state mutation path; eliminate the duplicate `GUARD_MAP`; the tool reads the resulting snapshot instead of mutating context directly
- **Council sign-off tool** — add a `workflow_council_signoff` tool or extend `workflow_transition` with a `council_signoff` action so the Planner can record Council sign-off programmatically
- **State history tracking** — replace single `previous_state` with a `state_history: StateTransition[]` array recording every transition with timestamp and role
- **DONE → PLANNING cycle restart** — add RESET event handler to DONE state so operator can `/workflow reset` from DONE back to PLANNING without editing state.json
- **Resolve open P2 finding** — add `src/integrity/hash.ts` to the contract scope

### Out of Scope (Phase 4+)

- TTSR rules (Typecheck, Test, Style, Run) — quality-gate integration
- Multi-project support
- Skills discovery integration
- Branch state tracking during IMPLEMENTING (real-time git branch detection)
- Concurrency control (state.json read-modify-write atomicity across sessions)
- Staleness detection (agents stuck in operator-gated states)

## 3. Architecture

### 3.1 Artifact Preservation

**Problem:** `writeState(ctx)` is a dumb write — it writes whatever context object it receives. If the caller loaded state, modified it, and passed it through — artifacts are preserved. But if any intermediate step constructs a fresh or partial context, artifacts vanish. The XState machine's `TransitionSnapshot` context is technically a complete context (initialized from the caller's context), but after `Object.assign(ctx, nextSnapshot.context)`, the machine's snapshot overwrites `ctx` fields. While the machine's `assign()` actions don't currently touch `artifacts`, this is a fragile invariant — future assign actions on new events could silently clobber artifacts.

**Fix:** Two-layered defense:

**Layer 1 — `writeState()` validation.** Before writing, assert that artifacts sealed in the context match what's on disk. If `ctx.artifacts` has fewer entries than the on-disk state, reject the write with a clear error. This catches partial-context bugs immediately.

```typescript
// In writeState():
const onDisk = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf-8")) : null;
if (onDisk) {
  const onDiskArtifacts = (onDisk.artifacts as Record<string, unknown>) ?? {};
  const ctxArtifacts = ctx.artifacts ?? {};
  const missing = Object.keys(onDiskArtifacts).filter(k => !(k in ctxArtifacts));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to write state: ${missing.length} artifact(s) would be lost: ${missing.join(", ")}. ` +
      `Ensure the caller used loadState() before modifying context.`
    );
  }
}
```

**Layer 2 — `transitionState()` helper.** Introduce a helper that encapsulates the `loadState()` → modify → `writeState()` pattern, making it the obvious and only way to transition state. The helper takes a callback that receives the loaded context and returns the modified context. This makes partial-context bugs structurally visible — any code path that constructs a fresh context without calling `loadState()` stands out.

```typescript
export function transitionState(
  role: Role,
  fn: (ctx: WorkflowContext) => { target: WorkflowState; ctx: WorkflowContext }
): WorkflowTransitionResult {
  const ctx = loadState();
  const { target, ctx: modified } = fn(ctx);
  modified.previous_state = ctx.state;
  modified.state = target;
  modified.transitioned_at = new Date().toISOString();
  modified.transitioned_by = role;
  writeState(modified);
  return { success: true, from: ctx.state, to: target };
}
```

Callers in `workflow_transition` switch from direct mutation to `transitionState()`. The approve/reset actions use the same helper.

**Files changed:**
- `src/integrity/state-persistence.ts` — add artifact preservation check to `writeState()`, add `transitionState()` helper
- `.omp/tools/workflow-transition/index.ts` — use `transitionState()` for all state mutations

### 3.2 Tool/Machine Unification

**Problem:** `workflow_transition` has two code paths for guards:

1. **Approve/reset actions** (lines 108–195): directly calls guard functions (`guardAwaitingApprovalToImplementing(ctx)`, `guardBlockedToPrevious(ctx)`), then mutates `ctx.state` directly.
2. **Regular transitions** (lines 206–337): looks up guard in `GUARD_MAP`, evaluates it, then mutates `ctx.state` directly AND also calls `machine.transition(snapshot, event)` — but only uses the snapshot for `Object.assign()`; the transition result (success/fail) is driven by the manual guard evaluation, not the machine.

The XState machine defines guards for every transition. But the tool never actually **sends** events to a running actor — it creates a fresh machine with `createWorkflowMachine(ctx)`, creates a new actor from it, gets a snapshot, and calls the low-level `machine.transition()` to compute the next snapshot. This is the source of divergence: the tool's `GUARD_MAP` is a manual reimplementation of the machine's guards.

**Why `actor.send()` isn't used:** The machine's initial state is set from `initialContext.state`. An `actor.send({ type: "TRANSITION", target, role })` would only work if the actor is in the correct state. Since the tool creates a fresh actor each time, it's always in the initial state — which matches `ctx.state` via `initial: initialContext.state`. So `actor.send()` **should** work.

**Fix:** Replace the tool's manual guard evaluation + state mutation with `actor.send()`:

```typescript
const machine = createWorkflowMachine(ctx);
const actor = createActor(machine);
actor.start();

// For regular transitions:
actor.send({ type: "TRANSITION", target, role });

// For approve (from AWAITING_OPERATOR_APPROVAL):
actor.send({ type: "SET_OPERATOR_APPROVAL", value: { approved: true, ... } });
actor.send({ type: "TRANSITION", target: "IMPLEMENTING", role });

// Read result:
const snapshot = actor.getSnapshot();
if (snapshot.value !== target) {
  // Transition was blocked by guard — extract reason from context
  return { success: false, error: "Guard blocked transition" };
}
// Persist the snapshot's context
writeState(snapshot.context as WorkflowContext);
```

**Challenge:** XState guards return `boolean`, not `GuardResult`. When a guard blocks, the machine stays in its current state but doesn't provide a reason string. The tool currently uses `guardResult.reason` for user-facing error messages.

**Solution:** Encode the failure reason in `context.transition_error` via a `BLOCK` event fallback. When a TRANSITION is blocked by a guard:
1. The machine stays in the current state (XState default)
2. The tool detects `snapshot.value !== target`
3. The tool sends a `BLOCK` event with the reason to transition to BLOCKED
4. The snapshot now has `block_reason` populated

Alternative: XState v5 supports `guard` with a `{ type, params }` object. But the guard function itself returns a boolean. We can keep the `GuardResult` pattern by having the guard write the reason to context before returning false — but XState guards are pure functions that receive context and event, they can't mutate. So we'd need an assign action that runs before the guard.

**Simpler alternative:** Keep a parallel `guardDescriptions` map that provides human-readable reasons for each guard, keyed by guard name. When a transition fails, look up the reason from the guard name. This is less duplication than the current `GUARD_MAP` approach.

**Decision:** Use `actor.send()` for state mutation, eliminate `GUARD_MAP`. For guard failure reasons, add a `guardFailureReason` map:

```typescript
const GUARD_FAILURE_REASONS: Record<string, string> = {
  canTransitionToAwaitingApproval: "Council sign-off required, design doc must be sealed",
  canTransitionToImplementing: "Operator approval required, validation contract must be sealed",
  // ...
};
```

When `actor.send()` results in no state change, look up the reason from the guard name. The machine definition includes guard names as metadata — we can extract them from the machine's `transition()` result.

**Files changed:**
- `.omp/tools/workflow-transition/index.ts` — major refactor: use `actor.send()`, remove `GUARD_MAP` and `VALID_TARGETS`
- `src/state-machine/machine.ts` — add `guardFailureReason` metadata to guard definitions (optional; could live in tool)
- `src/state-machine/guards.ts` — no changes (guards stay as-is; they work with XState)

### 3.3 Council Sign-Off Tool

**Problem:** `SET_COUNCIL_SIGN_OFF` is a valid XState event with an `assign()` action, but no tool or slash command invokes it. The Planner must manually edit `state.json` to record Council sign-off. Phase 2 retro confirms this gap.

**Fix:** Add a `council_signoff` action to `workflow_transition`:

```
workflow_transition(action="council_signoff", role="Planner")
```

Implementation in the tool:
1. Only valid from `PLANNING` state
2. Only `Planner` role can invoke
3. Sends `SET_COUNCIL_SIGN_OFF` event to the machine with structured `ApprovalRecord`
4. Persists the updated context

```typescript
if (params.action === "council_signoff") {
  if (params.role !== "Planner") {
    return { /* error: only Planner can record council sign-off */ };
  }
  if (ctx.state !== "PLANNING") {
    return { /* error: council sign-off only valid in PLANNING */ };
  }
  const machine = createWorkflowMachine(ctx);
  const actor = createActor(machine);
  actor.start();
  actor.send({
    type: "SET_COUNCIL_SIGN_OFF",
    value: {
      approved: true,
      approved_by: "Council",
      approved_at: new Date().toISOString(),
      method: "tool-call",
    },
  });
  const snapshot = actor.getSnapshot();
  writeState(snapshot.context as WorkflowContext);
  return { /* success */ };
}
```

**Note:** With the tool/machine unification (3.2), this becomes natural — `actor.send()` handles the event, `assign()` updates context, and `writeState()` persists the snapshot.

**Files changed:**
- `.omp/tools/workflow-transition/index.ts` — add `council_signoff` action
- `.omp/commands/workflow.md` — document `/workflow council-signoff` (if we want a slash command; alternatively, it's tool-only)

### 3.4 State History Tracking

**Problem:** `previous_state` is a single string, overwritten on every transition. A chain like `IMPLEMENTING → BLOCKED → VALIDATING` loses the original `IMPLEMENTING` state — the final `previous_state` is `BLOCKED`.

**Fix:** Add a `state_history` array to `WorkflowContext`:

```typescript
interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  at: string;          // ISO timestamp
  by: Role;
  reason?: string;     // populated for BLOCKED transitions
}

interface WorkflowContext {
  // ... existing fields ...
  state_history: StateTransition[];
}
```

**Schema migration:** v2 → v3. On load, if `schema_version < 3`, initialize `state_history` from the existing `previous_state` field (if present):

```typescript
if (version < 3) {
  result.state_history = result.previous_state
    ? [{ from: result.previous_state, to: result.state, at: result.transitioned_at ?? "unknown", by: result.transitioned_by ?? "unknown" }]
    : [];
}
```

**Transition helper updates:** `transitionState()` (from 3.1) appends to `state_history`:

```typescript
modified.state_history = [
  ...(ctx.state_history ?? []),
  { from: ctx.state, to: target, at: new Date().toISOString(), by: role },
];
```

**Retention policy:** Keep the last 50 entries to bound growth. `state.json` isn't a database — it's operational state. A sliding window is sufficient for audit.

**Files changed:**
- `src/state-machine/types.ts` — add `StateTransition` interface, add `state_history` to `WorkflowContext`, bump `schema_version` to 3
- `src/integrity/state-persistence.ts` — v2→v3 migration, validate `state_history` in schema check
- `src/state-machine/machine.ts` — update `assign()` actions to append to `state_history` on each transition
- `src/state-machine/smoke-test.ts` — add state history assertions

### 3.5 Resolve Open P2 Finding

**Finding:** `src/integrity/hash.ts` was modified (new `computeHashWithContent` function) but not declared in the Phase 2 contract scope.

**Resolution:** Add `src/integrity/hash.ts` to the Phase 3 validation contract's scope. This is accepted as a legitimate scope miss — the function was an infrastructure dependency the Planner didn't anticipate. Future mitigation (Phase 4): `git diff` check that warns on changed files outside contract scope.

**Files changed:**
- `.omp/workflow/validation-contract-phase-3.md` — include hash.ts in scope

### 3.6 DONE → PLANNING Cycle Restart (P1-1 from Council review)

**Problem:** DONE is a terminal state (`type: "final"`) with no outgoing transitions. The `/workflow reset` command only works from BLOCKED. Starting a new planning cycle requires the operator to manually edit `state.json` — bypassing all machine enforcement. This is the exact kind of manual state manipulation the workflow was designed to prevent.

**Trigger:** Every development cycle that reaches DONE. Currently blocking Phase 3 planning.

**Fix:** Add a RESET event handler to the DONE state in the XState machine:

```typescript
DONE: {
  // DONE is no longer "final" — it can be reset to start a new cycle
  on: {
    RESET: {
      target: "PLANNING",
      actions: assign({
        state: "PLANNING",
        previous_state: "DONE",
        artifacts: {},                     // new cycle, fresh artifacts
        council_sign_off: null,            // new cycle, fresh approvals
        operator_approval: null,
        findings_open: [],                 // archive below
        findings_history: ({ context }) => [
          ...(context.findings_history ?? []),
          ...(context.findings_open ?? []).map(f => ({ ...f, status: "closed" as const, closed_at: new Date().toISOString() })),
        ],
        block_reason: null,
        transitioned_at: () => new Date().toISOString(),
        transitioned_by: ({ event }) => (event as { role: Role }).role,
      }),
    },
  },
},
```

**Tool changes:** The `workflow_transition` tool's reset handler already checks `if (currentState === "BLOCKED")`. Extend to also handle `currentState === "DONE"`:

```typescript
if (params.action === "reset") {
  if (params.role !== "Operator") { /* error */ }
  if (currentState === "BLOCKED" || currentState === "DONE") {
    const machine = createWorkflowMachine(ctx);
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "RESET", role: params.role });
    const snapshot = actor.getSnapshot();
    writeState(snapshot.context as WorkflowContext);
    return { /* success */ };
  }
  return { /* error: reset only valid from BLOCKED or DONE */ };
}
```

**Note:** The v2→v3 migration in `loadState()` will encounter DONE states that are `type: "final"`. The migration handles this — `schema_version` bump is additive, and the machine is re-created with the migrated context on next tool call.

**Files changed:**
- `src/state-machine/machine.ts` — change DONE from `type: "final"` to state with RESET handler
- `.omp/tools/workflow-transition/index.ts` — extend reset handler to accept DONE state

**Interaction with state_history:** The RESET transition appends to `state_history` (via the unified `transitionState()` helper / machine assign), recording `{ from: "DONE", to: "PLANNING" }`. This preserves the audit trail across cycles.

## 4. Known Failure Modes Addressed

| Failure | Phase 2 Status | Phase 3 Fix |
|---|---|---|
| Artifact loss on transition | Happened 3+ times, no guard | `writeState()` validates artifacts before overwriting; `transitionState()` helper enforces pattern |
| Tool/machine divergence | Two code paths, two P0 findings | `actor.send()` is the single mutation path; `GUARD_MAP` eliminated |
| Council sign-off is manual | Planner edits state.json | `workflow_transition(action="council_signoff")` tool action |
| State history is single-deep | `previous_state` overwritten | `state_history: StateTransition[]` with sliding window |
| DONE is a dead end | Manual state.json edit to restart | `/workflow reset` from DONE, machine handles RESET event with artifact/approval clearing |
| Contract scope miss (hash.ts) | P2 finding open | Add to Phase 3 contract scope |

## 5. Files Changed (Delta Scope)

```
src/state-machine/machine.ts               — state_history in assign() actions, DONE RESET handler (final → resettable), TRANSITION_ERROR event
src/state-machine/guards.ts                — no changes (guards stay pure)
src/integrity/state-persistence.ts          — artifact preservation in writeState(), transitionState() helper, v2→v3 migration
src/integrity/hash.ts                      — no changes (scope miss, included in contract)
.omp/tools/workflow-transition/index.ts    — major refactor: actor.send() + transitionState(), council_signoff action, DONE reset support, remove GUARD_MAP
.omp/tools/workflow-status/index.ts        — display state_history in status output
.omp/commands/workflow.md                  — document /workflow council-signoff
.omp/skills/workflow-protocol/SKILL.md     — document council_signoff action, state_history field
.omp/workflow/validation-contract-phase-3.md — include hash.ts in scope
src/state-machine/smoke-test.ts            — assertions for artifact preservation, state_history, council_signoff, tool/machine unification
```

## 6. Verification Plan

1. `bun run typecheck` passes on all touched files
2. `bun run src/state-machine/smoke-test.ts` — existing 106 assertions pass, new assertions for:
   - **Artifact preservation:** `writeState()` with lost artifacts throws; `transitionState()` preserves all artifacts through a transition chain
   - **Tool/machine unification:** transitions via `actor.send()` reach correct state; guard failure leaves state unchanged and provides reason
   - **Council sign-off:** `council_signoff` action records ApprovalRecord; invalid state/role rejected
   - **State history:** `state_history` grows on each transition; v2→v3 migration preserves existing `previous_state` as first history entry; sliding window caps at 50
   - **Regression:** all existing transition guards still enforced (structured contracts, branch protection, approval audit trail, hash integrity)
3. `/workflow status` displays state history chain
4. `/workflow council-signoff` succeeds in PLANNING, rejected elsewhere
5. Artifact loss is caught: write a partial context → `writeState()` throws with artifact names

## 7. Risks

- **Tool/machine unification is the largest refactor.** The `workflow_transition` tool's execute function (currently 267 lines, 72–339) will be substantially rewritten. Risk: introducing regressions in approve/reset logic. Mitigation: the existing 106 smoke tests cover all transitions; expand coverage to include the `actor.send()` path explicitly.
- **Guard failure reasons become less specific.** Currently `guardResult.reason` provides detailed messages like "Council sign-off is pending (null) — Planner-Council review must run before transition." With the `GUARD_FAILURE_REASONS` map, reasons are static strings. Mitigation: if this proves too coarse, a future iteration can encode the reason into a context field via a pre-guard assign action.
- **`writeState()` artifact validation may be too strict.** If a transition legitimately removes an artifact (e.g., re-sealing with a different key), the validation would block it. Mitigation: only validate that artifact count doesn't decrease; allow changes to individual artifact entries (different hash/path for same key).
- **Schema v2→v3 migration.** v2 is the current schema. The migration adds `state_history` and bumps `schema_version`. Risk: zero — additive change only, backward-compatible.

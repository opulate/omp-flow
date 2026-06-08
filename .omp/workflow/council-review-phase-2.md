# Council Review — Phase 2 Design Doc

**Review date:** 2026-06-08
**Reviewer:** Council

## Review Checks

### 1. Guard conditions sufficient for Phase 2 scope?

**Structured validation contracts:** The contract schema (`scope.files` + `assertions`) is machine-verifiable. Explicit rejection of globstars and catch-all patterns closes the bypass that existed in Phase 1. The `isValidWorkflowContext` addition — validating contract structure on state load — provides defense-in-depth: even a manually edited state.json won't bypass the check. ✓

**Approval audit trail:** Replacing bare booleans with `ApprovalRecord` is the right level of structure. Timestamp + identity + method covers the three concerns (who, when, how). The v1→v2 migration is one-way additive — no data loss path. ✓

**BLOCKED dynamic target:** The v5 dynamic target pattern `target: ({ context }) => context.previous_state ?? "PLANNING"` is correct and the spec for v5. The guard still validates `previous_state` exists, so null falls through to the default PLANNING. ✓

**Findings in status:** Returning `CouncilFinding[]` instead of counts is the minimum viable fix. The type already declares it — this is filling a gap, not adding complexity. ✓

### 2. Scope discipline — is anything creeping?

Scope is well-bounded. The five out-of-scope items (TTSR rules, multi-project, skills discovery, branch state tracking, concurrency control) are explicitly listed. Each has a clear rationale for deferral. The retro's warning about sequencing is respected — three tightly related improvements rather than five unrelated ones.

One concern: the `isValidWorkflowContext` contract validation on load adds a cross-cutting concern (state-persistence.ts reaching into contract structure). This is acceptable because it's defense-in-depth, not primary enforcement — the guard in `guardAwaitingApprovalToImplementing` handles the transition path.

### 3. Breaking change impact?

The v1→v2 schema migration is the only breaking change. State is currently PLANNING with zero artifacts — no in-flight work to corrupt. The migration code path runs once on first load after upgrade. Risk is low.

The `SET_OPERATOR_APPROVAL` event signature change (`{ value: boolean }` → structured record) is documented as a breaking change, and the design explicitly notes that no in-flight work exists. Acceptable.

### 4. Are the four known failure modes still addressed?

| Failure | Phase 1 | Phase 2 | Status |
|---|---|---|---|
| Validator asserts repo-wide | Human gate | Machine gate (structured contracts) | Strengthened |
| Planner-Council review skipped | Guard requires council_sign_off | Same + audit trail on approval | Maintained |
| Council severity inflation | Trigger conditions required | Unchanged | Maintained |
| Agents skip steps or misroute | workflow-gate hook | Same + BLOCKED reset preserves state | Strengthened |

All four remain addressed. Two are strengthened.

### 5. Missing anything critical?

- **No concurrency control** (P2-12 from Phase 1). The design acknowledges this as out of scope with a clear rationale. Acceptable for Phase 2 — concurrency is a Phase 3 concern once the system sees real multi-agent use.

- **No staleness detection** (P2-11). Operator-gated states can stall indefinitely. The design defers this. Acceptable — first-run guidance (`next_action`) partially mitigates by telling agents what to do.

- **No role validation in guards** (P1-8). The design doesn't address this. The TRANSITION event carries a `role` field that guards don't validate. Noted but acceptable — role enforcement lives in the workflow-gate hook and operator controls, not in individual guard functions.

## Findings

### P2 — `workflow_transition` tool directly writes state (non-blocking)

The tool bypasses the XState machine for state writes, using `ctx.state = target; writeState(ctx)` directly. The machine is used for validation (`machine.transition()`) but the resulting snapshot is merged via `Object.assign()`. This means machine-level `assign()` actions won't fire correctly for all transitions.

**Trigger:** If a future change adds `assign()` actions to a transition, the direct write will silently skip them.

**Recommendation:** Phase 3 should refactor to use `actor.send()` as the primary state mutation path, with the tool reading the resulting snapshot and writing that.

### P2 — Contract schema version not validated

The design says contracts have `"version": 1` but the `validateContractStructure()` function doesn't describe version-gating behavior. If the contract format changes in Phase 3, old contracts will parse with unknown assertion types.

**Trigger:** Phase 3 adds a new assertion type; Phase 2 contract is loaded and silently accepted with partial validation.

**Recommendation:** Add explicit version check in `validateContractStructure()` — reject unknown versions with a clear message.

### P3 — `isValidWorkflowContext` contract validation duplicates guard logic

Both `isValidWorkflowContext` (state-persistence) and `validateContractStructure` (guards) will parse and validate contracts. This is intentional defense-in-depth but creates a dual-write obligation if the schema changes.

**Trigger:** Contract schema v2 added; only one validation site is updated.

**Recommendation:** Extract `validateContractStructure` to a shared location, call from both sites.

## Verdict

**CLEAR** — No P0 or P1 findings. The design is sound, scope is disciplined, and the four known failure modes remain addressed (two strengthened). Two P2 improvements noted for Phase 3, one P3 deduplication suggestion.

The structured contracts close the biggest Phase 1 gap (heuristic enforcement). The full slash command suite completes the operator-facing surface. The approval audit trail and BLOCKED fix address specific council findings without architectural changes.

## Sign-off

Council sign-off: ✓ Approved

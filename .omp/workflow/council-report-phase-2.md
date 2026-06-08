# Council Report — Phase 2 Implementation Review

**Review date:** 2026-06-08
**Reviewer:** Council
**State:** AWAITING_COUNCIL_REVIEW

## Artifact Verification

| Artifact | Path | Hash Status |
|---|---|---|
| `design-doc` | `.omp/workflow/design-doc-phase-2.md` | ✓ OK (recovered) |
| `validation-contract` | `.omp/workflow/validation-contract-phase-2.md` | ✓ OK (recovered) |
| `impl-complete` | `.omp/workflow/impl-complete-phase-2.md` | ✓ OK |

*Note: design-doc and validation-contract artifacts had to be recovered during this review — the state.json migration dropped them. See P1-2.*

## Findings

### P0 — Critical: Must fix before validation

#### P0-1: Approve action bypasses structured contract guard

**Location:** `.omp/tools/workflow-transition/index.ts:114-129`

The `/workflow approve` action (`action: "approve"`) writes state directly to `IMPLEMENTING` without calling `guardAwaitingApprovalToImplementing`. This entirely bypasses `validateContractStructure()` — the Phase 2 marquee feature that enforces structured validation contracts. An operator running `/workflow approve` from `AWAITING_OPERATOR_APPROVAL` will transition to `IMPLEMENTING` even if the validation contract is free-text or has globstar patterns.

**Trigger condition:** Operator calls `workflow_transition(action="approve", role="Operator")` after Planner has sealed a free-text validation contract (e.g. "Contract: validate all files"). The approve action accepts it without examining the contract. Observable: implementation begins with a structurally invalid contract, defeating the Phase 2 machine enforcement.

**Fix:** Add guard evaluation to the approve action path. After setting `operator_approval`, call `guardAwaitingApprovalToImplementing(ctx)` before writing state. On guard failure, return the guard's reason and do not transition.

---

#### P0-2: BLOCKED reset in tool bypasses guardBlockedToPrevious

**Location:** `.omp/tools/workflow-transition/index.ts:192-210`

The tool's BLOCKED reset handler (regular TRANSITION path, not the `action: "reset"` path) computes `resetTarget = ctx.previous_state ?? "PLANNING"` and writes state directly without calling `guardBlockedToPrevious`. When `previous_state` is null, the tool allows RESET to PLANNING — but the guard explicitly blocks this transition.

**Trigger condition:** Operator calls `workflow_transition(target="PLANNING", role="Operator")` from BLOCKED with `previous_state: null`. The tool computes `resetTarget = "PLANNING"` (null fallback), accepts it, and writes state. Observable: state resets to PLANNING without a valid previous_state, violating the guard contract and creating a state where the transition trail is lost.

**Fix:** Call `guardBlockedToPrevious(ctx)` before the reset. On `allowed: false`, return the guard's reason and do not transition.

---

### P1 — High: Should fix; significant quality or correctness impact

#### P1-1: isValidWorkflowContext does not validate contract structure on load

**Location:** `src/integrity/state-persistence.ts:104-158`

The design doc specified defense-in-depth contract validation in `isValidWorkflowContext`: "if state === 'AWAITING_OPERATOR_APPROVAL' and validation-contract is sealed, validate the contract content against the schema on load." This was not implemented. `isValidWorkflowContext` validates only structural types (state string, artifacts shape, approval record shape), not contract content.

**Trigger condition:** Operator manually edits state.json, sets `state: "IMPLEMENTING"`, and retains a validation-contract with free-text content. On next `loadState()`, no contract validation fires. Observable: state loads successfully with invalid contract, and the operator can bypass structured contract enforcement through state.json editing alone (no tool needed).

**Fix:** Add contract structure validation to `isValidWorkflowContext` when state transitions through an operator-gated state and a validation-contract artifact exists. This is defense-in-depth — not a substitute for fixing P0-1.

---

#### P1-2: Direct state.json write destroyed existing artifacts during migration

**Location:** Observed during review — artifacts were lost when state.json was rewritten to v2 format.

The v2 migration in `loadState()` handles individual field migration correctly, but `writeState()` has no preservation or validation of artifact integrity. When state.json was rewritten from scratch (migrating bare booleans to ApprovalRecord), the `design-doc` and `validation-contract` artifacts were dropped. The `backupCorruptedState()` mechanism only fires on corruption, not on intentional migration writes.

**Trigger condition:** Any code path that calls `writeState(ctx)` with a ctx constructed from `createInitialContext()` (rather than `loadState()` → modify → `writeState()`) drops all existing artifacts. Observable: sealed artifacts silently disappear from state.

**Fix:** Add an assertion or validation in `writeState()` that warns or errors when artifacts are being dropped. Alternatively, the migration path should use `loadState()` → modify → `writeState()` exclusively.

---

#### P1-3: Action-based reset also bypasses guardBlockedToPrevious

**Location:** `.omp/tools/workflow-transition/index.ts:155-178`

The `action: "reset"` handler (the `/workflow reset` implementation) also bypasses `guardBlockedToPrevious`. It checks `currentState === "BLOCKED"` and `role === "Operator"` but never calls the guard. Same structural issue as P0-2 but lower severity because operator role enforcement provides partial mitigation (only Operator can trigger it, and they're trusted).

**Trigger condition:** Operator calls `workflow_transition(action="reset", role="Operator")` from BLOCKED with `previous_state: null`. Observable: same effect as P0-2 — reset to PLANNING without valid previous_state.

**Fix:** Call `guardBlockedToPrevious(ctx)` before executing the reset. Reject with guard reason on failure.

---

#### P1-4: extractContractJson fallback may misparse non-JSON content

**Location:** `src/state-machine/guards.ts:280-284`

The `extractContractJson` function has a fallback that scans for first `{` and last `}` in the content. If the markdown contains a JSON code fence followed by a non-JSON brace elsewhere (e.g., a code snippet containing `{ ... }` unrelated to the contract), the fallback extracts the span between them and produces a misleading parse error instead of the clear "must use structured format" message.

**Trigger condition:** Contract markdown has:
```markdown
```json
{ "version": 1, "scope": { "files": ["src/foo.ts"] }, "assertions": [...] }
```
Some commentary text mentioning `{ braces }` in prose.
```
The fallback extracts from the first `{` in the JSON block to the last `}` in the prose, producing invalid JSON. Observable: `JSON.parse` fails with a generic "invalid JSON" error, not the "must use structured format" guidance.

**Fix:** Remove the fallback path and only accept explicit ` ```json ` fenced blocks. The guidance message for missing JSON is clearer than a confusing parse error.

---

### P2 — Medium: Should address; does not block validation

#### P2-1: Invalid JSON error message lacks parse error details

**Location:** `src/state-machine/guards.ts:307-311`

When `JSON.parse` throws, the guard returns `"Validation contract contains invalid JSON. Fix the JSON block before re-sealing."` without including the parse error message. The Planner gets a generic message and must manually debug the JSON.

**Trigger condition:** Planner writes a contract with a JSON syntax error (trailing comma, missing quote). Observable: generic error message, no line number or syntax hint.

**Fix:** Include the parse error.message in the reason: `` `Validation contract contains invalid JSON: ${err.message}. Fix the JSON block before re-sealing.` ``

---

#### P2-2: No tool to set council_sign_off

**Location:** `src/state-machine/machine.ts:85-86` — `SET_COUNCIL_SIGN_OFF` event exists in the machine but has no corresponding tool or slash command.

The Planner must directly edit state.json to record council sign-off. This was a Phase 1 gap that Phase 2's operator-focused work (approve, reset) did not address.

**Trigger condition:** Planner needs to record council sign-off during PLANNING → AWAITING_OPERATOR_APPROVAL. Observable: no tool exists; `council_sign_off` must be set via direct state.json edit.

**Fix:** Phase 3 — add a `/workflow council-approve` or similar subcommand, or extend the `workflow_transition` tool to accept `SET_COUNCIL_SIGN_OFF` events.

---

### P3 — Low: Cosmetic or future improvement

*(None raised — the implementation quality is otherwise high.)*

## Summary

| Severity | Count | Blocker |
|---|---|---|
| P0 | 2 | Yes — must fix before VALIDATING |
| P1 | 4 | Strongly recommend fix before VALIDATING |
| P2 | 2 | No — can wait for Phase 3 |
| P3 | 0 | — |

## Verdict

**NOT CLEAR** — Two P0 findings (P0-1, P0-2) must be addressed before validation. Both involve the workflow_transition tool bypassing guards that are the primary enforcement mechanism for Phase 2's features.

The P0 findings are surgical: add guard calls to specific code paths in the tool. Estimated fix effort: ~10 lines of code. The P1 findings strengthen the implementation but do not independently block validation.

**Recommendation:** Fix P0-1 and P0-2, then re-submit for council re-review. P1 findings can be addressed in the same pass or deferred to Phase 3 at the implementor's judgment.

## Council Sign-off

**Council decision:** Return to IMPLEMENTING for P0 fixes.

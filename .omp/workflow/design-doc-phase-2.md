# Phase 2 Design Doc — Structured Contracts & Operator Controls

**Feature:** Structured validation contracts, full slash command suite, and council findings remediation.
**Status:** Draft (pre-approval)
**Date:** 2026-06-08

## 1. Problem Statement

Phase 1 delivered the core state machine with guard-enforced transitions, SHA-256 artifact integrity, and a workflow-gate pre-hook. It works — but three known weaknesses limit enforcement quality:

1. **Validation contract scope is a human gate, not a machine gate.** The `guardAwaitingApprovalToImplementing` checks operator approval + artifact integrity only. The operator must read the contract and decide if it's delta-scoped. No structural enforcement exists — a contract that says "run tests on all files" passes the machine check. The `hasRepoWideAssertions()` heuristic was removed in Phase 1 as unreliable (false positives, trivial bypasses). Machine-verifiable contracts are needed.

2. **Operator controls are incomplete.** The slash command only supports `status`. `approve` and `reset` are defined as stubs, leaving the operator with no way to advance the workflow without directly editing `state.json`.

3. **Council findings from Phase 1 are unaddressed.** The Phase 1 retrospective identified specific P0/P1 findings that remain in the codebase: bare boolean approvals with no audit trail (P1-4), BLOCKED reset hardcoded to PLANNING instead of restoring previous state (P0-3), and `workflow_status` returning finding counts but not finding content (P0-7).

## 2. Scope (Phase 2)

### In Scope

- **Structured validation contracts** — machine-verifiable contract format with explicit file scope
- **Full slash command suite** — `/workflow approve` and `/workflow reset` (operator-only)
- **Approval audit trail** — replace `boolean | null` approvals with structured records (approved_by, approved_at, method)
- **BLOCKED dynamic target resolution** — restore to `previous_state` instead of hardcoding PLANNING
- **Workflow status includes findings** — return actual `CouncilFinding[]` in status, not just count
- **First-run guidance** — `workflow_status` surfaces next actions and available transitions
- **Bug fix: artifact-verify syntax** — missing `})` in zod object definition

### Out of Scope (Phase 3+)

- TTSR rules
- Multi-project support
- Skills discovery integration
- Branch state tracking during IMPLEMENTING (real-time git branch detection)
- Concurrency control (state.json read-modify-write atomicity)
- Staleness detection (agents stuck in operator-gated states)

## 3. Architecture

### 3.1 Structured Validation Contracts

Contracts will follow a defined JSON schema. The Planner writes the contract in this format; the guard parses and validates structure before allowing transition.

**Contract schema:**

```json
{
  "version": 1,
  "scope": {
    "files": ["src/state-machine/types.ts", "src/state-machine/guards.ts"]
  },
  "assertions": [
    { "type": "typecheck", "description": "bun run typecheck on scoped files" },
    { "type": "test", "command": "bun run src/state-machine/smoke-test.ts" },
    { "type": "no-extra-files", "description": "No file outside declared scope is modified" }
  ]
}
```

**Enforcement:**

- `guardAwaitingApprovalToImplementing` will call `validateContractStructure(contractContent)` which:
  1. Parses the JSON
  2. Validates `scope.files` is a non-empty array of string paths
  3. Rejects contracts with zero files, globstars (`**`), or catch-all patterns (`"*"`, `"all"`)
  4. Validates `assertions` is a non-empty array
  5. Returns `GuardResult` — pass or fail with specific reason

- Contracts in the old free-text format will be rejected with: `"Validation contract must use structured format (JSON with scope.files + assertions). See SKILL.md for schema."`

- The `isValidWorkflowContext` function in `state-persistence.ts` gains a check: if `state === "AWAITING_OPERATOR_APPROVAL"` and `validation-contract` is sealed, validate the contract content against the schema on load. This prevents operators from approving a contract the machine would reject.

**Files changed:**
- `src/state-machine/types.ts` — add `ValidationContract`, `ContractAssertion` types
- `src/state-machine/guards.ts` — add `validateContractStructure()`, wire into `guardAwaitingApprovalToImplementing`
- `.omp/skills/workflow-protocol/SKILL.md` — document contract schema

### 3.2 Full Slash Command Suite

**`/workflow approve`**

Operator-only. Advances the workflow past operator-gated states:
- In `AWAITING_OPERATOR_APPROVAL`: records operator approval, transitions to `IMPLEMENTING`
- In `AWAITING_MERGE`: records operator approval, transitions to `DONE`
- In any other state: returns error with available transitions

The approve command:
1. Reads current state
2. Validates operator is in a gate state
3. Sets `operator_approval` record in context
4. Calls `workflow_transition` with `role: "Operator"` and the correct target
5. Returns structured result

**`/workflow reset`**

Operator-only. Resets from error states:
- In `BLOCKED`: transitions to `previous_state` (via dynamic target)
- In `ERROR`: transitions to `PLANNING`
- In any other state: returns error

The reset command:
1. Reads current state
2. Validates operator is in a reset-able state
3. Calls `workflow_transition` with `RESET` event
4. Returns structured result

**Implementation:**
- Update `.omp/commands/workflow.md` — remove Phase 1 scope limitation, add implementation details
- Add approval/reset logic to `workflow_transition` tool (or create separate command handlers)
- The slash command parser routes `approve`/`reset` to appropriate tool calls

### 3.3 Approval Audit Trail (P1-4 remediation)

Replace bare booleans with structured records:

```typescript
// Before (Phase 1)
council_sign_off: boolean | null;
operator_approval: boolean | null;

// After (Phase 2)
interface ApprovalRecord {
  approved: boolean;
  approved_by: Role;
  approved_at: string;
  method: "slash-command" | "state-edit" | "tool-call";
}
council_sign_off: ApprovalRecord | null;
operator_approval: ApprovalRecord | null;
```

**Migration:** `schema_version` in `state.json` bumps to 2. `loadState()` handles v1→v2 migration: `boolean | null` → `ApprovalRecord | null` (true → `{ approved: true, approved_by: "Operator", approved_at: "unknown", method: "state-edit" }`, false → same with `approved: false`).

**Files changed:**
- `src/state-machine/types.ts` — add `ApprovalRecord`, update `WorkflowContext`
- `src/integrity/state-persistence.ts` — v1→v2 migration logic
- `src/state-machine/guards.ts` — update all approval checks
- `src/state-machine/machine.ts` — update event types
- `.omp/tools/workflow-transition/index.ts` — handle approval records
- `.omp/tools/workflow-status/index.ts` — display approval details
- `src/state-machine/smoke-test.ts` — update assertions

### 3.4 BLOCKED Dynamic Target Resolution (P0-3 remediation)

Current behavior: BLOCKED → RESET always goes to PLANNING. The tool writes `previous_state` to context, but the machine hardcodes the target.

Fix: The machine's BLOCKED RESET handler uses XState v5 dynamic target:

```typescript
// Before
RESET: { target: "PLANNING", guard: "guardBlockedToPrevious" }

// After
RESET: {
  target: ({ context }) => context.previous_state ?? "PLANNING",
  guard: "guardBlockedToPrevious",
}
```

The guard still validates `previous_state` exists. If null, the transition is blocked.

**Files changed:**
- `src/state-machine/machine.ts` — dynamic target on BLOCKED RESET

### 3.5 Workflow Status Returns Findings (P0-7 remediation)

`workflow_status` tool currently returns `findings_open_count` and `p0p1_count` — counts, not content. The `WorkflowStatusResult` type already declares `findings_open: CouncilFinding[]`, but the tool doesn't populate it.

Fix: Populate `findings_open` in the tool's `details` output, and include a human-readable summary in the text output.

**Files changed:**
- `.omp/tools/workflow-status/index.ts` — populate findings in result

### 3.6 First-Run Guidance (P1-12 remediation)

When state is PLANNING and no artifacts are sealed, `workflow_status` includes guidance:

```
State: PLANNING
Next: Write a design doc and seal it with artifact_seal(key="design-doc"),
      then run Planner-Council review before requesting operator approval.
      See .omp/agents/planner.md for responsibilities.
```

**Files changed:**
- `.omp/tools/workflow-status/index.ts` — add `next_action` field and guidance text

## 4. Known Failure Modes Addressed

| Failure | Phase 1 Status | Phase 2 Fix |
|---|---|---|
| Validator asserts repo-wide | Human gate (operator reads contract) | Machine gate (structured contract schema enforcement) |
| Approval lacks audit trail | Bare booleans | Structured `ApprovalRecord` with timestamp/identity |
| BLOCKED reset loses state | Hardcoded to PLANNING | Dynamic target restores `previous_state` |
| Findings invisible to agent | Count only in status | Full `CouncilFinding[]` returned |
| First-run has no guidance | Silent PLANNING state | `next_action` field surfaces next steps |

## 5. Files Changed (Delta Scope)

```
src/state-machine/types.ts          — ApprovalRecord, ValidationContract types, schema_version 2
src/state-machine/guards.ts         — validateContractStructure(), updated approval checks
src/state-machine/machine.ts        — BLOCKED dynamic target, updated ApprovalRecord event
src/integrity/state-persistence.ts  — v1→v2 migration, contract structure validation on load
.omp/tools/workflow-transition/     — approval record handling, dynamic reset target
.omp/tools/workflow-status/         — findings in result, first-run guidance, approval details
.omp/tools/artifact-verify/         — fix syntax bug (missing `})`)
.omp/commands/workflow.md           — approve/reset implementation details
.omp/skills/workflow-protocol/      — document contract schema, approval records
src/state-machine/smoke-test.ts     — updated assertions for Phase 2 changes
```

## 6. Verification Plan

1. `bun run typecheck` passes on all touched files
2. `bun run src/state-machine/smoke-test.ts` — existing 45 assertions pass, new assertions for:
   - Structured contract validation (valid contract passes, missing files rejected, globstar rejected)
   - Approval record handling (v1→v2 migration, distinct messages for pending/denied/approved)
   - BLOCKED → RESET restores previous_state (not hardcoded PLANNING)
3. `/workflow status` returns findings array and next_action when appropriate
4. `/workflow approve` succeeds in AWAITING_OPERATOR_APPROVAL and AWAITING_MERGE
5. `/workflow reset` succeeds in BLOCKED, restores to previous_state
6. `artifact_verify` tool parses correctly (syntax fix verified)
7. v1 state.json auto-migrates to v2 on first load (round-trip test)

## 7. Risks

- **Schema migration:** v1→v2 introduces a breaking change to `state.json`. Risk is low — Phase 1 artifacts are already cleared (`"artifacts": {}`), and the migration is one-way additive. Corruption risk is handled by the existing `backupCorruptedState()` mechanism.
- **Contract format adoption:** Existing contracts (free-text) will be rejected by the new guard. This is by design — Phase 2 starts fresh. The error message guides the Planner to the new format.
- **Dynamic target in XState v5:** The `target: ({ context }) => …` pattern is a v5 feature. Smoke tests must verify it resolves correctly with a valid `previous_state` and correctly blocks when null.
- **Approval record compatibility:** The machine's `SET_OPERATOR_APPROVAL` event used `{ type: "SET_OPERATOR_APPROVAL"; value: boolean }`. After Phase 2, this changes to a structured record. Any Phase 1 code sending this event will break. Since the repo is in PLANNING with zero artifacts, no in-flight work exists.

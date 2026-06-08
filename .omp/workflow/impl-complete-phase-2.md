# Implementation Complete — Phase 2

**Date:** 2026-06-08
**Feature:** Structured Contracts & Operator Controls

## What Was Implemented

### 1. Structured Validation Contracts
- `ValidationContract` and `ContractAssertion` types in `types.ts`
- `validateContractStructure()` guard in `guards.ts` — parses JSON, validates scope.files, rejects globstars/catch-alls, validates assertions
- `extractContractJson()` helper extracts JSON from markdown fences
- Wired into `guardAwaitingApprovalToImplementing` — contract must pass structure validation
- Free-text contracts rejected with guidance message pointing to SKILL.md schema

### 2. Full Slash Command Suite
- `workflow_transition` tool extended with `action: "approve"` and `action: "reset"` parameters
- `/workflow approve` — operator-only, advances from AWAITING_OPERATOR_APPROVAL → IMPLEMENTING or AWAITING_MERGE → DONE
- `/workflow reset` — operator-only, resets from BLOCKED → previous_state (dynamic target)
- Role enforcement: agents cannot self-approve

### 3. Approval Audit Trail (P1-4 remediation)
- `ApprovalRecord` type with `approved`, `approved_by`, `approved_at`, `method` fields
- Replaced bare `boolean | null` for `council_sign_off` and `operator_approval`
- v1→v2 schema migration in `state-persistence.ts` — auto-converts on load
- Schema validation updated to accept both v1 booleans and v2 ApprovalRecords
- Guards updated with distinct messages: "pending" (null) vs "denied" (approved: false)
- State.json bumped to schema_version 2

### 4. BLOCKED Dynamic Target Resolution (P0-3 remediation)
- Machine RESET handler keeps `target: "PLANNING"` as safe default
- Workflow_transition tool handles dynamic restoration of `previous_state` from context
- Guard validates `previous_state` exists before allowing reset
- Block reason cleared on reset

### 5. Workflow Status Improvements (P0-7 + P1-12 remediation)
- `workflow_status` returns `findings_open: CouncilFinding[]` in details (not just counts)
- Human-readable findings summary in text output
- ApprovalRecord details shown (who, when, method)
- `next_action` field: first-run guidance when PLANNING with no artifacts
- Block reason shown when BLOCKED

### 6. Bug Fix
- `artifact-verify/index.ts`: fixed missing `})` closing the zod object definition

## Files Changed

| File | Change |
|---|---|
| `src/state-machine/types.ts` | ApprovalRecord, ValidationContract, ContractAssertion types; schema_version 2 |
| `src/state-machine/guards.ts` | validateContractStructure(), extractContractJson(), updated approval checks |
| `src/state-machine/machine.ts` | Updated WorkflowEvent types, BLOCKED comment clarification |
| `src/integrity/state-persistence.ts` | v1→v2 migration, migrateApproval(), updated isValidWorkflowContext() |
| `.omp/tools/workflow-transition/index.ts` | approve/reset actions, optional target parameter |
| `.omp/tools/workflow-status/index.ts` | findings array, ApprovalRecord display, next_action guidance |
| `.omp/tools/artifact-verify/index.ts` | Syntax fix (missing `})`) |
| `.omp/commands/workflow.md` | Phase 2 implementation docs |
| `.omp/skills/workflow-protocol/SKILL.md` | Contract schema, ApprovalRecord docs |
| `src/state-machine/smoke-test.ts` | 106 assertions (was 49), Phase 2 test sections 9-11 |

## Verification

- TypeScript compiles clean (`bun run typecheck`)
- 106 smoke test assertions pass, 0 fail
- Tests cover: ApprovalRecord (pending/denied/approved), structured contracts (8 cases), BLOCKED dynamic target
- Existing Phase 1 assertions all preserved and updated for v2 compatibility

# Workflow Protocol

The omp-flow state machine enforces the 5-role development workflow.

## States

| State | Description |
|---|---|
| `PLANNING` | Scope tasks, write design docs, define validation contracts |
| `AWAITING_OPERATOR_APPROVAL` | Operator reviews and approves the plan |
| `IMPLEMENTING` | Executing on approved design, on feature branch |
| `AWAITING_COUNCIL_REVIEW` | Council reviews implementation against design |
| `VALIDATING` | Validator runs contract assertions on delta scope |
| `RETRO` | Document what worked, what didn't, carry-forward risks |
| `AWAITING_MERGE` | Operator reviews and merges |
| `DONE` | Workflow complete — terminal state |
| `ERROR` | Unrecoverable error — operator reset required |
| `BLOCKED` | Gate check failed — operator reset to previous state |

## Valid Transitions

```
PLANNING               → AWAITING_OPERATOR_APPROVAL   (Planner seals design doc)
AWAITING_OPERATOR_APPROVAL → IMPLEMENTING             (operator approves)
IMPLEMENTING           → AWAITING_COUNCIL_REVIEW      (impl-complete artifact sealed)
AWAITING_COUNCIL_REVIEW → IMPLEMENTING                (Council returns findings)
AWAITING_COUNCIL_REVIEW → VALIDATING                  (Council clears)
VALIDATING             → RETRO                        (validation report sealed)
VALIDATING             → IMPLEMENTING                 (Validator finds regressions)
RETRO                  → AWAITING_MERGE               (retro complete)
AWAITING_MERGE         → DONE                         (operator merges)
any                    → BLOCKED                      (gate check fails)
BLOCKED                → previous state               (operator resets)
```

## Guarantees

1. **No skipped roles** — transitions enforce that each role has completed its work
2. **Artifact integrity** — SHA-256 hashes prevent tampering after sealing
3. **Council mandatory** — cannot reach VALIDATING without Council sign-off
4. **Delta-scoped contracts** — Validator cannot assert repo-wide; contract authorship enforced at seal
5. **Operator gate** — agent cannot self-approve transitions requiring operator action
6. **Feature branch discipline** — IMPLEMENTING → AWAITING_COUNCIL_REVIEW requires non-main branch
7. **Finding quality** — P0/P1 findings require realistic trigger conditions

## Artifact Keys

| Key | Sealed By | Used At |
|---|---|---|
| `design-doc` | Planner | PLANNING → AWAITING_OPERATOR_APPROVAL, Council review |
| `validation-contract` | Planner | AWAITING_OPERATOR_APPROVAL → IMPLEMENTING, Validator verify |
| `impl-complete` | Implementor | IMPLEMENTING → AWAITING_COUNCIL_REVIEW |
| `council-report` | Council | AWAITING_COUNCIL_REVIEW → VALIDATING/IMPLEMENTING |
| `validation-report` | Validator | VALIDATING → RETRO |
| `retro-doc` | Retro | RETRO → AWAITING_MERGE |

## Tools

- `workflow_status` — read current state (includes findings, approval details, state_history, first-run guidance)
- `workflow_transition(target?, role, action?)` — attempt state transition (guard evaluated via XState machine)
  - `action: "approve"` — operator approval from AWAITING_OPERATOR_APPROVAL or AWAITING_MERGE
  - `action: "reset"` — operator reset from BLOCKED or DONE
  - `action: "council_signoff"` — Planner records Council sign-off from PLANNING
- `artifact_seal(key, path, role)` — compute SHA-256 and record in state
- `artifact_verify(key, path)` — recompute hash and compare against stored record

## State History (Phase 3)

Every transition is recorded in `state_history: StateTransition[]` (schema v3+):

```json
{
  "state_history": [
    {
      "from": "PLANNING",
      "to": "AWAITING_OPERATOR_APPROVAL",
      "at": "2026-06-08T03:24:07.032Z",
      "by": "Planner",
      "reason": "Guard failed: hash mismatch"
    }
  ]
}
```

- `reason` is populated for BLOCKED transitions
- Last 50 entries kept; older entries pruned
- v2→v3 migration initializes `state_history` from `previous_state`
- `workflow_status` displays the last 3 entries; full history in `details.state_history`

## Artifact Preservation (Phase 3)

`writeState()` validates that artifacts in the context being written are not fewer than what's on disk. Writing a partial context that drops artifacts throws an error. The `transitionState()` helper encapsulates `loadState()` → modify → `writeState()` as the canonical pattern.

## Cycle Lifecycle (Phase 3)

DONE is no longer a terminal state. The operator can `/workflow reset` from DONE to start a new planning cycle. The reset clears artifacts, approvals, and archives open findings to `findings_history`.

## Approval Records (Phase 2)

Council sign-off and operator approval use structured `ApprovalRecord` with audit trail:

```json
{
  "approved": true,
  "approved_by": "Operator",
  "approved_at": "2026-06-08T02:21:14.301Z",
  "method": "slash-command"
}
```

`method` is one of: `"slash-command"` (via /workflow approve), `"tool-call"` (via workflow_transition), `"state-edit"` (v1 migration).

## Validation Contract Schema (Phase 2)

Contracts MUST use structured JSON format within a markdown file:

```json
{
  "version": 1,
  "scope": {
    "files": ["src/state-machine/types.ts", "src/state-machine/guards.ts"]
  },
  "assertions": [
    { "type": "typecheck", "description": "bun run typecheck on scoped files" },
    { "type": "test", "command": "bun run src/state-machine/smoke-test.ts", "description": "All smoke tests pass" },
    { "type": "no-extra-files", "description": "No file outside declared scope is modified" }
  ]
}
```

**Rules:**
- `scope.files` must be a non-empty array of explicit file paths
- No globstars (`**`), catch-alls (`*`, `all`, `all files`), or repo-wide patterns
- `assertions` must be non-empty with `type` and `description` per entry
- Contracts in free-text format are rejected at the AWAITING_OPERATOR_APPROVAL → IMPLEMENTING guard
- The guard calls `validateContractStructure()` which parses and validates before allowing transition

## Hook

The `workflow-gate` pre-hook intercepts tool calls that imply role actions and blocks on invalid state:
- DONE: blocks all modifications
- IMPLEMENTING: blocks git operations on `main`
- AWAITING_COUNCIL_REVIEW: blocks code modifications
- VALIDATING: blocks code modifications
- BLOCKED: blocks everything except workflow_status and workflow_transition

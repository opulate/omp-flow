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

- `workflow_status` — read current state
- `workflow_transition(target, role)` — attempt state transition (guard evaluated)
- `artifact_seal(key, path, role)` — compute SHA-256 and record in state
- `artifact_verify(key, path)` — recompute hash and compare against stored record

## Hook

The `workflow-gate` pre-hook intercepts tool calls that imply role actions and blocks on invalid state:
- DONE: blocks all modifications
- IMPLEMENTING: blocks git operations on `main`
- AWAITING_COUNCIL_REVIEW: blocks code modifications
- VALIDATING: blocks code modifications
- BLOCKED: blocks everything except workflow_status and workflow_transition

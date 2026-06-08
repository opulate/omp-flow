# Phase 1 Design Doc — Minimal Working Enforcement

**Feature:** Minimal working enforcement — the smallest surface that makes discipline optional.
**Status:** Draft (pre-approval)
**Date:** 2026-06-08

## 1. Problem Statement

The current omp development workflow relies on agent discipline for state transitions. Agents can skip Council, proceed with untouched artifacts, and write Validator contracts that assert repo-wide zero errors. Under complexity, discipline degrades.

omp-flow makes transitions mechanical — an agent cannot proceed without passing a verified guard.

## 2. Scope (Phase 1)

### In Scope

- XState v5 statechart with all states and valid transitions defined
- `workflow_transition` tool — guard evaluation + state write
- `artifact_seal` and `artifact_verify` tools — SHA-256 implementation via Node `crypto`
- `workflow-gate.ts` pre-hook — intercepts and blocks role-implying actions on invalid state
- `workflow_status` tool — readable current state
- `/workflow` slash command — `status` subcommand only
- State persisted to `.omp/workflow/state.json`
- Role definitions for all 5 roles (`.omp/agents/`)
- workflow-protocol SKILL.md for agent reference

### Out of Scope (Phase 2+)

- TTSR rules
- Full slash command suite (`approve`, `reset`)
- Skills discovery integration
- Multi-project support
- XState machine dynamic target resolution for BLOCKED resets (simplified to PLANNING)

## 3. Architecture

### Component Map

```
src/
  state-machine/
    types.ts          — State, Context, Role, Finding types
    guards.ts         — Guard functions per transition
    machine.ts        — XState v5 statechart

  integrity/
    hash.ts           — SHA-256 compute/verify via Node crypto
    state-persistence.ts — loadState/writeState for .omp/workflow/state.json

.omp/
  tools/
    workflow-transition/index.ts  — Guard eval + state transition
    workflow-status/index.ts      — Read current state
    artifact-seal/index.ts        — SHA-256 seal
    artifact-verify/index.ts      — SHA-256 verify
  hooks/pre/
    workflow-gate.ts              — Pre-hook intercept
  commands/
    workflow.md                   — /workflow slash command
  agents/                         — Role definitions
  skills/workflow-protocol/       — Protocol reference
```

### State Machine

10 states, 11 valid transitions. BLOCKED is the universal error state — any state can transition to BLOCKED on gate failure. RESET from BLOCKED restores to the previous state (simplified to PLANNING in the XState machine for type compatibility; actual restoration handled by the tool writing correct previous_state to the context file).

### Guard Functions

Each guard evaluates the current context against the requirements:
- `guardPlanningToAwaitingApproval` — design doc sealed, council sign-off
- `guardAwaitingApprovalToImplementing` — operator approval, contract sealed, delta-scope check
- `guardImplementingToAwaitingCouncil` — impl-complete sealed, feature branch, not main
- `guardAwaitingCouncilToValidating` — council report sealed, no P0/P1 open, trigger conditions
- `guardValidatingToRetro` — validation report sealed
- `guardRetroToAwaitingMerge` — retro doc sealed
- `guardAwaitingMergeToDone` — operator approval

### Integrity Model

SHA-256 computed via Node `crypto.createHash("sha256")`. On seal, hash stored in state.json alongside path and timestamp. On verify, recompute and compare. State writes are atomic (temp file + rename).

## 4. Known Failure Modes Addressed

| Failure | Fix |
|---|---|
| Validator asserts repo-wide zero errors | Guard requires delta-scoped contracts; `hasRepoWideAssertions()` heuristic checks for globstar patterns and "all files" language |
| Planner-Council review skipped | PLANNING → AWAITING_OPERATOR_APPROVAL guard requires `council_sign_off` |
| Council severity inflation | Council role definition requires realistic trigger conditions on all P0/P1 findings |
| Agents skip steps or misroute | workflow-gate hook blocks tool calls that imply role actions on invalid state |

## 5. Verification Plan

- TypeScript compiles without errors (`bun run typecheck`)
- `workflow_status` returns correct initial state (PLANNING)
- `artifact_seal` creates a hash and records it in state.json
- `artifact_verify` confirms hash match after seal, detects mismatch after modification
- `workflow_transition` blocks invalid transitions (e.g. IMPLEMENTING without impl-complete sealed)
- `workflow-gate` hook blocks writes during AWAITING_COUNCIL_REVIEW and VALIDATING
- State persists correctly across tool calls

## 6. Risks

- **Hook loading**: The omp harness must load `.omp/hooks/pre/` hooks. If auto-discovery doesn't work for nested paths, the hook may need explicit loading.
- **Tool discovery**: The `subdirectory/index.ts` pattern is standard for omp custom tools. Path depth (`.omp/tools/<name>/index.ts`) should be auto-discovered.
- **Delta-scope heuristic**: The `hasRepoWideAssertions()` function uses pattern matching — could produce false positives on legitimate patterns. Acceptable for Phase 1; can be improved with structured contract format in Phase 2.

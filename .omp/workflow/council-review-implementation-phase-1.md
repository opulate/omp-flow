# Council Implementation Review — Phase 1

**Review date:** 2026-06-08
**Reviewer:** Council
**Artifacts verified:** design-doc ✓, impl-complete ✓, validation-contract ✓

## Scope Verification

| Scope Item | Status | Evidence |
|---|---|---|
| XState statechart (all states + transitions) | ✓ | `src/state-machine/machine.ts` — 10 states, 11 transitions, v5 `setup()` API |
| workflow_transition tool | ✓ | `.omp/tools/workflow-transition/index.ts` — guard eval + state write + structured errors |
| artifact_seal / artifact_verify | ✓ | `.omp/tools/artifact-seal/index.ts`, `.omp/tools/artifact-verify/index.ts` — SHA-256 via Node crypto |
| workflow-gate pre-hook | ✓ | `.omp/hooks/pre/workflow-gate.ts` — blocks writes during review/validation, main ops during implementation |
| workflow_status tool | ✓ | `.omp/tools/workflow-status/index.ts` — readable state with artifact/finding summaries |
| /workflow slash command | ✓ | `.omp/commands/workflow.md` — status subcommand defined |
| State persistence | ✓ | `src/integrity/state-persistence.ts` — atomic writes via temp file + rename |

## Out of Scope (correctly absent)

| Item | Status |
|---|---|
| TTSR rules | ✓ Not present |
| Full slash command suite (approve, reset) | ✓ Not present (status only) |
| Skills discovery integration | ✓ Not present |
| Multi-project support | ✓ Not present |

## Guard Condition Review

Each transition guard was exercised in smoke tests. Additional manual review:

- **PLANNING → AWAITING_OPERATOR_APPROVAL**: Requires council_sign_off + design-doc sealed + hash match. ✓
- **AWAITING_OPERATOR_APPROVAL → IMPLEMENTING**: Requires operator_approval + contract sealed + delta-scope check. ✓
- **IMPLEMENTING → AWAITING_COUNCIL_REVIEW**: Requires impl-complete sealed + hash match + feature branch ≠ main. ✓
- **AWAITING_COUNCIL_REVIEW → VALIDATING**: Requires council-report sealed + no P0/P1 open + trigger conditions on all P0/P1. ✓
- **VALIDATING → RETRO**: Requires validation-report sealed + hash match. ✓
- **RETRO → AWAITING_MERGE**: Requires retro-doc sealed. ✓
- **AWAITING_MERGE → DONE**: Requires operator_approval. ✓

## Hook Coverage

| State | Blocked Actions | Coverage |
|---|---|---|
| DONE | All except workflow_status | ✓ |
| IMPLEMENTING | git ops on main (bash) | ✓ |
| AWAITING_COUNCIL_REVIEW | write, edit, ast_edit | ✓ |
| VALIDATING | write, edit, ast_edit | ✓ |
| BLOCKED | All except workflow_status, workflow_transition | ✓ |

## Findings

### P2 — Delta-scope heuristic uses pattern matching (non-blocking)

The `hasRepoWideAssertions()` function in `guards.ts` uses regex patterns to detect repo-wide assertions. False positives are possible on legitimate patterns (e.g., "**/tests/**" used in a scoped contract). Acceptable for Phase 1. **Trigger:** Valid contract containing globstar-like syntax is rejected. **Recommendation:** Phase 2 should use structured contract format with explicit file lists.

### P2 — Branch tracking is point-in-time (non-blocking)

The hook only blocks explicit git operations targeting `main`. If the Implementor checks out `main` manually and then writes files, the hook won't catch it — only the transition guard will block later. Acceptable for Phase 1. **Trigger:** Implementor on main branch (not in git ops) writes code; caught only at transition time. **Recommendation:** Phase 2 could track current git branch in real-time.

### P3 — BLOCKED reset target is simplified (cosmetic)

The XState machine simplifies BLOCKED → RESET to always target PLANNING. The actual previous_state restoration is handled by the tool writing correct context. The machine's runtime state divergence is transient (next tool call recreates from state.json). **Trigger:** N/A — functional behavior is correct.

## Verdict

**CLEAR** — No P0 or P1 findings. All scope items delivered. All four known failure modes addressed. Two P2 improvements deferred to Phase 2, one P3 cosmetic note. Implementation is approved for validation.

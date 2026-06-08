# Council Review — Phase 1 Design Doc

**Review date:** 2026-06-08
**Reviewer:** Council (acting)

## Review Checks

### 1. Guard conditions sufficient to prevent the four known failure modes?

**Validator asserts repo-wide zero errors** → Covered. The `guardAwaitingApprovalToImplementing` checks for repo-wide assertion patterns (`**\/*.ts`, "all files", "entire repo", "every file"). The check is heuristic (pattern matching) rather than structural, which is acceptable for Phase 1. Improvement in Phase 2: require a structured contract format with explicit file scoping.

**Planner-Council review skipped** → Covered. `guardPlanningToAwaitingApproval` requires `council_sign_off === true` before transitioning. The Council sign-off is set via `SET_COUNCIL_SIGN_OFF` event, which must be explicitly recorded.

**Council severity inflation** → Covered. Council role definition (`.omp/agents/council.md`) requires realistic trigger conditions on all P0/P1 findings. The `guardAwaitingCouncilToValidating` checks that all P0/P1 findings have non-empty `trigger_conditions`. Additional enforcement: the role definition explicitly states that "Could theoretically happen" is not sufficient.

**Agents skip steps or misroute** → Covered. The `workflow-gate` pre-hook blocks modifying tools during AWAITING_COUNCIL_REVIEW and VALIDATING, blocks bash operations on main during IMPLEMENTING, and blocks all actions when DONE or BLOCKED.

### Finding: Guard coverage is sufficient for Phase 1. No P0/P1 findings.

### 2. Hook intercept surface — are there role-implying tool calls not covered?

Current hook coverage:
- `DONE` → blocks all except workflow_status
- `IMPLEMENTING` → blocks git ops targeting main in bash
- `AWAITING_COUNCIL_REVIEW` → blocks write/edit/ast_edit
- `VALIDATING` → blocks write/edit/ast_edit
- `BLOCKED` → blocks all except workflow_status and workflow_transition

**Gaps identified (P2 — acceptable for Phase 1):**
- `ast_grep` tool is not in the blocking set for review/validation states — but ast_grep is read-only, so not a gap
- `bash` tool during AWAITING_COUNCIL_REVIEW and VALIDATING is not blocked — could allow running tests or other side effects. Acceptable for Phase 1 since the Council and Validator may need to run commands for analysis.
- No enforcement that `git checkout main` + `write` during IMPLEMENTING is blocked — the hook only blocks explicit git operations on main, not writes after checking out. The guard (`feature_branch !== "main"`) covers this at transition time, but not mid-implementation. Phase 2 improvement: track branch state.

### Finding: No P0/P1 gaps. Two P2 improvements noted for Phase 2.

### 3. Contract delta-scope rule — does it hold in the Validator role definition?

The Validator role definition (`.omp/agents/validator.md`) explicitly states:
- "Delta-scoped only — the contract asserts on files touched by the PR, never repo-wide"
- "Writing or modifying the validation contract" is listed as an anti-pattern
- "Running repo-wide assertions" is listed as an anti-pattern

The guard `guardAwaitingApprovalToImplementing` checks the contract content for repo-wide patterns before allowing transition from operator approval to implementation. The Validator verifies the contract hash via `artifact_verify` before running, ensuring the contract hasn't been tampered with after sealing.

### Finding: Delta-scope rule is properly enforced at both the Planner seal-time and Validator verify-time. No issues.

## Verdict

**CLEAR** — No P0 or P1 findings. The design is sound for Phase 1. Two P2 improvements identified for Phase 2 (non-blocking):
1. Structured contract format with explicit file scoping
2. Branch state tracking during IMPLEMENTING to prevent main-branch writes

## Sign-off

Council sign-off: ✓ Approved

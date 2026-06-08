# Council Report — omp-flow Full Review

**Date:** 2026-06-08
**Review Type:** Full council (adversary, advocate, archaeologist, architect, CTO, pragmatist)
**Codebase:** omp-flow Phase 1 implementation (~1,050 lines impl + ~335 lines tests)

---

## P0 Findings

### P0-1: No Schema Validation on Loaded State — Complete Workflow Bypass

**Raised by:** Adversary, Archaeologist, Architect *(3 members)*
**Location:** `src/integrity/state-persistence.ts:22-25` (loadState)

`loadState()` does `JSON.parse(raw) as WorkflowContext` — a TypeScript cast with **zero runtime validation**. Any valid JSON is accepted as workflow truth. The `??` fallbacks only guard against `undefined`/`null` — they do not validate types. If `state.json` contains `{ "state": "DONE", "operator_approval": true, ... }`, it is trusted unconditionally. All guard conditions rendered advisory.

**Fix:** Add runtime schema validation (structural check or Zod/valibot). Validate: `state ∈ WORKFLOW_STATES`, artifacts values are objects with `path`/`hash`/`sealed_at`/`sealed_by`, `findings_open` is `CouncilFinding[]`, boolean-or-null fields are correctly typed. On validation failure, do NOT silently create fresh state — throw or return structured error preserving the corrupted file for forensics.

---

### P0-2: Silent State Destruction on Corrupted state.json

**Raised by:** Advocate, Adversary *(2 members)*
**Location:** `src/integrity/state-persistence.ts:35-37` (loadState catch block)

If `JSON.parse` throws (malformed JSON, truncated write, disk corruption), the catch block calls `createInitialContext()` + `writeState(initial)` — **silently overwriting corrupted state with fresh PLANNING**. All workflow progress destroyed. No backup. No warning. No recovery path. The agent sees `state: "PLANNING"` with zero artifacts and has no way to know data was lost.

**Fix:** On parse failure, do NOT overwrite. Save corrupted file as `.omp/workflow/state.json.corrupted.{timestamp}`. Throw or return explicit error: `"Workflow state file is corrupted. Backup saved. Restore or /workflow reset."` Agent must explicitly acknowledge and reset.

---

### P0-3: BLOCKED → RESET Hardcodes PLANNING — Guard Is Dead Code

**Raised by:** Advocate, Architect, Archaeologist *(3 members)*
**Location:** `src/state-machine/machine.ts:289-302`, `src/state-machine/guards.ts:322-330`

Three components disagree:
- **Spec** (cold-start doc): `BLOCKED → previous state`
- **guards.ts**: `guardBlockedToPrevious` exists, checks `ctx.previous_state` — but **never imported in machine.ts**
- **machine.ts**: RESET handler hardcodes `target: "PLANNING"`, with a comment admitting: *"The workflow_transition tool handles restoring the actual previous_state"* — a tool that doesn't exist yet

Every operator reset destroys all progress back to PLANNING. The guard function is dead code — recognized the correct behavior, wrote code for it, abandoned it because the machine couldn't express it.

**Fix:** Wire `guardBlockedToPrevious` into the machine. Use XState v5's dynamic target (`target: ({ context }) => context.previous_state ?? "PLANNING"`). Remove the external-tool-will-fix-it comment.

---

### P0-4: Unhandled Exceptions in Guard Functions — Silent Guard Failures

**Raised by:** Adversary
**Location:** `src/state-machine/guards.ts` (all guards calling `computeHash`/`readFile`)

`computeHash()` calls `readFileSync()` which can throw for: permission denied, EISDIR (artifact path is a directory), named pipe/FIFO (blocks indefinitely — **process hang**), or OOM (no size limit). No guard wraps these in try/catch. XState v5 treats guard exceptions as guard failure — transition silently blocked with no diagnostic. Agent cannot distinguish runtime error from legitimate rejection.

**Fix:** (1) Wrap all `computeHash`/`readFile` calls in try/catch returning `{ allowed: false, reason: actualErrorMessage }`. (2) Add `statSync(path).isFile()` check before `readFileSync` to reject non-regular files. (3) Add file size limit (~10 MB for artifact files).

---

### P0-5: TOCTOU on Contract Content Verification — Delta-Scope Bypass

**Raised by:** Adversary
**Location:** `src/state-machine/guards.ts:75-85` (guardAwaitingApprovalToImplementing)

Guard reads contract file **twice**: `computeHash(path)` for hash check, then `readFile(path)` for content check. If file is deleted between reads, `readFile` returns `null`, and `if (contractContent)` silently skips content verification. Transition allowed without delta-scope check ever running. This defeats one of the four documented failure modes.

**Fix:** Read file once — hash content in memory for comparison, then pass same content to `hasRepoWideAssertions()`. Eliminates TOCTOU window entirely.

---

### P0-6: Block Reason Never Stored — Agent Enters BLOCKED Blind

**Raised by:** Advocate
**Location:** `src/state-machine/machine.ts` (all BLOCK event handlers)

When a guard fails, the system fires a BLOCK event with a perfectly good `reason` string. The machine transitions to BLOCKED — **the reason is discarded**. `WorkflowContext` has no `block_reason` field. Agent calls `workflow_status`, sees `{ state: "BLOCKED" }`, and has no idea why they're stuck or what to fix. From BLOCKED the only event is RESET (back to PLANNING), so there's no transition to retry. The reason is lost forever.

**Fix:** Add `block_reason: string | null` to `WorkflowContext`. BLOCK handler must `assign({ block_reason: ({ event }) => event.reason })`. `WorkflowStatusResult` must include `block_reason`.

---

### P0-7: Open Findings Invisible — Agent Sees Count But Not Content

**Raised by:** Advocate
**Location:** `src/state-machine/types.ts:102` (WorkflowStatusResult.findings_open_count)

`workflow_status` returns `findings_open_count: 3` — just a number. Agent cannot see what the findings ARE. Finding descriptions, severities, and trigger conditions are only visible when a transition guard fails. Agent cannot plan remediation without attempting and failing a transition first. This turns finding resolution into a frustrating game of "try to transition, read the error, fix one thing, try again."

**Fix:** Return `findings_open: CouncilFinding[]` in the status result (or at minimum a summary with severity + description + trigger_conditions). The status tool should be the single source of truth for "what's blocking me."

---

## P1 Findings

### P1-1: Guard Functions Have Direct Filesystem Dependency

**Raised by:** Architect
**Location:** `src/state-machine/guards.ts:3-5`

Guards import `computeHash` and `readFile` directly. Their true contract is `(WorkflowContext, Filesystem) → GuardResult`, but the type signature lies — callers can't know guards reach out to disk. Cannot unit test without real filesystem. Every guard is an integration test.

**Fix:** Extract a `HashVerifier` interface `{ verify(path, storedHash): boolean; read(path): string | null }`. Inject it into guards. Machine already injects guards — extend to inject verifier.

---

### P1-2: Artifact Key Namespace Is Scattered String Literals

**Raised by:** Archaeologist (P0), Architect (P1), CTO (P2) *(3 members)*
**Location:** Across `guards.ts` and `smoke-test.ts` (~20 locations)

Six artifact keys (`"design-doc"`, `"validation-contract"`, `"impl-complete"`, `"council-report"`, `"validation-report"`, `"retro-doc"`) are inline string literals. A typo in any guard silently fails — lookup returns `undefined`, guard reports "No artifact sealed" while the artifact exists under the correct key.

**Fix:** Define `ArtifactKey` union type and const object in `types.ts`. Use everywhere. Change `Record<string, ArtifactRecord>` to `Partial<Record<ArtifactKey, ArtifactRecord>>`.

---

### P1-3: Hash Verification Pattern Duplicated 6 Times

**Raised by:** Architect (P1), Pragmatist (P2) *(2 members)*
**Location:** `src/state-machine/guards.ts` (6 guards, ~120 lines of duplicate pattern)

Every guard repeats: check artifact exists → check hash field → compute current hash → check file exists → compare. Six copies of the same 4-step pattern. Future change like "also verify file size" touches all six sites.

**Fix:** Extract `verifyArtifactIntegrity(ctx, key): GuardResult | null` — returns `null` on success, `GuardResult` on failure. Guards collapse from ~120 lines to ~30 lines of calls plus a ~20-line helper.

---

### P1-4: operator_approval/council_sign_off Are Bare Booleans — No Audit Trail

**Raised by:** Architect, Archaeologist *(2 members)*
**Location:** `src/state-machine/types.ts:54-55`

Two critical human-in-the-loop approvals are nullable booleans. No timestamp. No identity. No distinction between "operator approved" and "state file corrupted to flip a bit." The cold-start doc says operator approval is a manual step — but the data model cannot distinguish manual from automated.

**Fix:** Replace booleans with structured records: `{ approved_by: Role; approved_at: string; method: "cli" | "slash-command" }`. Aligns with existing `ArtifactRecord` pattern.

---

### P1-5: Council→Implementor→Council Loop Has No Finding Delta Tracking

**Raised by:** CTO
**Location:** `src/state-machine/guards.ts:75-80`

When Council returns findings, `guardImplementingToAwaitingCouncil` checks only impl-complete artifact + feature branch — does NOT verify findings were addressed. Implementor can seal new impl-complete ignoring all findings and transition back. No finding lifecycle (opened/addressed/closed), no delta tracking between review iterations.

**Fix:** Add finding lifecycle: `id` (UUID), `status` (open/addressed/closed), `addressed_in` referencing impl-complete hash. Guard must verify all P0/P1 have status `"addressed"` before allowing transition.

---

### P1-6: Dogfood Gap — System Unvalidated Under Real Conditions

**Raised by:** CTO
**Location:** `.omp/workflow/state.json` (PLANNING, zero artifacts)

The repo contains full workflow artifacts (council reviews, validation report, retro doc) but `state.json` shows the state machine never advanced past PLANNING. The enforcement system wasn't enforced during its own development. Unknown whether seal/verify round-trips survive real agent cycles or Council loop produces actionable errors.

**Fix:** Run this repo through its own workflow end-to-end before declaring Phase 1 complete.

---

### P1-7: BLOCK Guard Is Dead Code — BLOCK Events Always Succeed

**Raised by:** Adversary
**Location:** `src/state-machine/machine.ts:62`

`canTransitionToBlocked` guard is registered but never referenced in any state's BLOCK handler. All BLOCK handlers have no guard property. Any agent can force BLOCKED at any time.

**Fix:** Wire the guard or remove it and document BLOCKED as always reachable by design.

---

### P1-8: No Role Validation in Guards

**Raised by:** Adversary
**Location:** All guards

`TRANSITION` event carries `role: Role`, but no guard validates the actor's role. A Planner can send `role: "Operator"` and target `"DONE"`. Combined with forged `operator_approval: true` in state.json, impersonation is undetected.

**Fix:** Guards should validate `event.role` against expected role for that transition. If role enforcement is planned for the pre-hook, document the dependency for defense in depth.

---

### P1-9: operator_approval Conflates "pending" and "rejected"

**Raised by:** Archaeologist
**Location:** `src/state-machine/types.ts:61-62`, guards checking `!ctx.operator_approval`

`boolean | null` has three states: `null` = undecided, `false` = rejected, `true` = approved. But every guard uses `!ctx.operator_approval`, blocking on both `null` and `false` with the same message: "Operator approval has not been recorded." An operator who explicitly rejected sees a message implying inaction.

**Fix:** Use distinct error messages: "pending" for `null`, "denied" for `false`. Or switch to enum: `ApprovalStatus = "pending" | "approved" | "rejected"`.

---

### P1-10: Feature Branch Guard Only Blocks "main"

**Raised by:** Adversary (P2), Archaeologist (P1) *(2 members)*
**Location:** `src/state-machine/guards.ts:146`

Guard checks `!== "main"` — repos using `"master"` bypass this check entirely. Implementation on default branch goes undetected.

**Fix:** Check against `["main", "master"]` or a configurable protected branch list.

---

### P1-11: hasRepoWideAssertions Is Heuristic, Not Enforcement

**Raised by:** CTO (P2), Archaeologist (P1), Pragmatist (P1) *(3 members)*
**Location:** `src/state-machine/guards.ts:105-114`

Regex patterns detect repo-wide contracts. False positives: `"Run tests on all files in src/auth/"` matches but IS delta-scoped. False negatives trivial: `"Run the test suite"` doesn't match but IS repo-wide. AI agents learn the bypass patterns immediately. Creates illusion of enforcement.

**Fix (Pragmatist):** Delete it — contract scope enforcement belongs at operator approval, where a human reads the contract. **Fix (Archaeologist/CTO):** Rename to `looksRepoWide()` to signal fallibility. Document limitations. Defer formal contract verification to Phase 2.

---

### P1-12: First-Run Experience — No Guidance, No Next Step

**Raised by:** Advocate
**Location:** `src/integrity/state-persistence.ts:17-18`

Fresh PLANNING state returns `{ state: "PLANNING", artifacts: {}, ... }` with zero guidance on what to do next. Agent doesn't know what PLANNING means, what artifacts are needed, or how to advance.

**Fix:** When `state === "PLANNING"` and artifacts empty, include `next_action` field. Return available transitions from current state. Surface cold-start doc path.

---

### P1-13: computeHash Silently Conflates "not found" with Permission Errors

**Raised by:** Advocate
**Location:** `src/integrity/hash.ts:15-17`

`existsSync` returns `false` for permission-denied directories. `computeHash` returns `null`. Guard reports "file not found" when the file exists but can't be read. Agent debugs the wrong problem.

**Fix:** After `existsSync` returns false, attempt `readFileSync` anyway and catch `ENOENT` vs `EACCES`/`EPERM`. Return discriminated result distinguishing "not found", "permission denied", and "ok".

---

## P2 Findings

| # | Title | Location | Raised By |
|---|-------|----------|-----------|
| P2-1 | XState guard layer duplicates standalone guard functions — dual-write obligation | `machine.ts:43-64` | Pragmatist, CTO |
| P2-2 | Three always-allowed guards exist for symmetry only (~30 lines of JSDoc > body) | `guards.ts:218-226, 257-260, 299-301` | Pragmatist |
| P2-3 | TransitionTarget duplicates WorkflowState instead of deriving via `Exclude` | `types.ts:15-22` | Pragmatist, Archaeologist |
| P2-4 | SET_BRANCH/SET_PR events are per-state when they don't need to be | `machine.ts:84-88, 99-101` | Pragmatist |
| P2-5 | State path hardcoded — smoke test overwrites developer's real state.json | `state-persistence.ts:9` | Architect |
| P2-6 | findings_open has no audit trail or resolution history | `types.ts:56` | Architect |
| P2-7 | Guard-to-transition mapping only in machine.ts wiring — 3-hop trail to find implementation | `machine.ts:43-63` | Archaeologist |
| P2-8 | Smoke test cleanup incomplete — ~10 orphaned temp files if test fails early | `smoke-test.ts:318-322` | Archaeologist |
| P2-9 | ERROR state defined but unreachable — dead state in machine | `types.ts`, `machine.ts:273-285` | Advocate, Archaeologist, Architect, CTO |
| P2-10 | guardAwaitingMergeToDone comment says "Always allowed" but implementation requires approval | `guards.ts:298` | Advocate |
| P2-11 | No staleness detection — agent can be stuck in operator-gated states indefinitely | `types.ts:65-74` | Advocate |
| P2-12 | No concurrency control — read-modify-write cycle is not atomic | `state-persistence.ts:13-51` | Adversary |
| P2-13 | No schema version field — migration path blocked without version discriminator | `types.ts:49-61` | CTO, Architect |

---

## Acknowledgments (Positive Findings Across All Council Members)

1. **Guard error messages are genuinely good.** Clear, actionable, written for the agent user. Consistent pattern across all guards. *(Advocate)*

2. **State machine/guard separation correctly drawn.** Machine knows nothing about files or hashes. Guards contain all enforcement logic. Changing a guard doesn't require touching the machine. *(Architect)*

3. **Atomic write via temp file + rename is correct.** Same-directory temp avoids cross-filesystem failures and partial-write corruption. Comment explains the tradeoff. *(Archaeologist, Adversary, Architect, CTO)*

4. **Hash verification is thorough and consistent.** Every seal-gated transition verifies artifact integrity. Three distinct failure messages: not found, no hash recorded, hash mismatch. Smoke tests verify all three. *(Advocate)*

5. **GuardResult discriminated type is the right pattern.** Structured `{ allowed, reason? }` with human-readable strings. Enables operational debuggability. *(Adversary)*

6. **XState v5 is the right technology choice.** Expresses 10 states, 11 transitions, multi-target guarded transitions correctly. Guard injection uses v5's intended extension point. *(Architect, CTO)*

7. **createInitialContext() is a single factory.** Guards and tests don't duplicate the default context. Adding a field updates only the factory and interface. *(Archaeologist)*

8. **Zero external dependencies beyond xstate.** SHA-256 via Node crypto, file I/O via fs — minimal supply-chain risk. *(Adversary, CTO)*

9. **Scope discipline.** Phase 1 is minimal working enforcement. Phase 2 (TTSR, full slash commands, multi-project) explicitly deferred. *(CTO)*

10. **Cold-start doc is thorough.** Captures decisions, known failure modes, rationale. Should be referenced from code JSDoc. *(Archaeologist)*

11. **Smoke test is appropriately sized and covers real edge cases.** 38 assertions, no test abstraction layer. *(Pragmatist)*

12. **Dependency direction is correct.** `integrity/` → `state-machine/types` is the only cross-module boundary. Machine doesn't know how state is persisted. *(Architect)*

---

## Summary

| Severity | Count | Critical Themes |
|----------|-------|-----------------|
| P0 | 7 | Trust boundary (no validation), silent data loss (3 paths), deadlock (split-brain BLOCKED reset), unhandled errors (guards), TOCTOU |
| P1 | 13 | Coupling (filesystem, strings), missing audit trail (approvals, findings), heuristic enforcement (delta-scope), onboarding gaps |
| P2 | 13 | Duplication (guards, types, wiring), dead code (ERROR state, always-allowed guards), missing features (staleness, concurrency) |

**Bottom line:** Architecturally sound foundation with correct layering and technology choices. The critical risks are operational: state.json is trusted without validation, corrupted state is silently destroyed, and the BLOCKED reset path is broken. All P0s are fixable without architectural changes — they are holes in the implementation, not flaws in the design. The P1s represent structural debt that will compound in Phase 2 if not addressed now (artifact key registry, hash verification deduplication, audit trail for approvals). The P2s are cleanup and polish.

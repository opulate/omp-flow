# omp-flow — Agent Cold-Start Brief

**Project:** `omp-flow`  
**Purpose:** Mechanically enforced agentic workflow for omp — state-machine-gated role transitions with SHA-256 artifact integrity.  
**Operator:** Oli  
**Date:** 2026-06-08

---

## What You Are Building

`omp-flow` is a pure `.omp/` extension that turns the 5-role development workflow into a state machine. It lives entirely in project config — no harness code is touched.

**The problem it solves:** The current workflow relies on agent discipline for state transitions. Agents can skip Council, proceed with untouched artifacts, and write Validator contracts that assert repo-wide zero errors. Under complexity, discipline degrades. `omp-flow` makes transitions mechanical — an agent cannot proceed without passing a verified guard.

**Implementation surface:**
- **Custom tools** — `workflow_transition`, `workflow_status`, `artifact_seal`, `artifact_verify`
- **Hooks** — `pre` hook intercepts tool calls that imply role actions; blocks on invalid state
- **Skills** — protocol documentation injected on demand via `SKILL.md`
- **Slash commands** — `/workflow status`, `/workflow approve`, `/workflow reset` for operator control
- **XState** — statechart runs inside custom tools; not a harness concern
- **SHA-256** — computed in tool layer; state written to `.omp/workflow/state.json`

---

- 5-role model is correct and stays: Planner ↔ Council (bidirectional design review) → Operator Gate → Implementor ↔ Council → Validator → Retro
- Git worktree discipline stays
- Council is mandatory, not opt-in
- Validation contracts stay — the problem is contract quality and gate enforcement, not the concept
- Subagent spawning for context isolation stays
- XState is the transition engine, not a coordination bus
- `.omp/` only — zero harness modifications

---

## Workflow States

```
## Workflow States

```
PLANNING
AWAITING_DESIGN_REVIEW
AWAITING_OPERATOR_APPROVAL
IMPLEMENTING
AWAITING_COUNCIL_REVIEW
VALIDATING
RETRO
AWAITING_MERGE
DONE
ERROR
BLOCKED          — explicit error state for failed gate checks
```

Valid transitions:

```
PLANNING               → AWAITING_DESIGN_REVIEW        (Planner seals design doc + contract)
AWAITING_DESIGN_REVIEW → PLANNING                      (Council returns design findings)
AWAITING_DESIGN_REVIEW → AWAITING_OPERATOR_APPROVAL    (Council clears design + sign-off)
AWAITING_OPERATOR_APPROVAL → IMPLEMENTING              (operator approves)
IMPLEMENTING           → AWAITING_COUNCIL_REVIEW       (impl-complete artifact sealed)
AWAITING_COUNCIL_REVIEW → IMPLEMENTING                 (Council returns findings)
AWAITING_COUNCIL_REVIEW → VALIDATING                   (Council clears)
VALIDATING             → RETRO                         (validation report sealed)
VALIDATING             → IMPLEMENTING                  (Validator finds regressions)
RETRO                  → AWAITING_MERGE                (retro complete)
AWAITING_MERGE         → DONE                          (operator merges)
any                    → BLOCKED                       (gate check fails)
BLOCKED                → previous state                (operator resets)
```

---

## Guard Conditions Per Transition

**PLANNING → AWAITING_DESIGN_REVIEW**
- Design doc exists at declared path
- SHA-256 hash recorded in state
- Validation contract exists, sealed, and uses structured format

**AWAITING_DESIGN_REVIEW → PLANNING**
- Always allowed (Council returns design findings for rework)

**AWAITING_DESIGN_REVIEW → AWAITING_OPERATOR_APPROVAL**
- Council design sign-off present and approved in state
- Design doc unmodified (hash verified)
- No open P0/P1 design findings

## Artifact Integrity Model

On `artifact_seal(path)`:
- Compute SHA-256 of file at `path`
- Write to `.omp/workflow/state.json`:
  ```json
  {
    "artifacts": {
      "design-doc": { "path": "...", "hash": "...", "sealed_at": "...", "sealed_by": "Planner" }
    }
  }
  ```

On `artifact_verify(path, key)`:
- Recompute SHA-256
- Compare against stored hash for `key`
- Return pass/fail — do not proceed on fail

Contracts are sealed by the Planner before transitioning to `AWAITING_DESIGN_REVIEW`. The Validator recomputes the hash before running assertions. A modified contract fails the gate.

---

## Repo Structure to Initialise

```
omp-flow/
  .omp/
    agents/
      planner.md
      implementor.md
      council.md
      validator.md
      retro.md
    tools/
      workflow-transition/
        index.ts        — XState transition + guard evaluation
      workflow-status/
        index.ts        — read current state
      artifact-seal/
        index.ts        — SHA-256 seal
      artifact-verify/
        index.ts        — SHA-256 verify
    hooks/
      pre/
        workflow-gate.ts  — intercepts role-implying actions, blocks on invalid state
    skills/
      workflow-protocol/
        SKILL.md          — state definitions, valid transitions, guard conditions
    commands/
      workflow.md         — /workflow slash command (status | approve | reset)
    workflow/
      state.json          — persisted workflow state (gitignored in dev, committed on PRs)
  src/
    state-machine/
      machine.ts          — XState statechart
      guards.ts           — guard functions
      types.ts            — state and context types
    integrity/
      hash.ts             — SHA-256 utilities
  package.json
  tsconfig.json
  AGENTS.md
  README.md
```

---

## Step 1 — Initialise the Repo

1. Create the directory structure above
2. `package.json` — bun project, dependencies: `xstate`, `@oh-my-pi/pi-coding-agent` (dev)
3. `tsconfig.json` — target ESNext, module NodeNext
4. `AGENTS.md` — points agents to `.omp/agents/` for role definitions and `.omp/skills/workflow-protocol/SKILL.md` for protocol
5. `.gitignore` — ignore `node_modules/`, `.omp/workflow/state.json` during active development

---

## Step 2 — Initialise the Workflow for This Project

Before building any feature, initialise the workflow so that all subsequent development on `omp-flow` itself runs through it.

Create `.omp/agents/` role definitions based on the 5-role model:

**Planner** — scopes tasks, writes design docs and validation contracts, seals artifacts, calls `workflow_transition(AWAITING_DESIGN_REVIEW)` for Council design review. After Council clears design, records council_signoff and transitions to `AWAITING_OPERATOR_APPROVAL`.

**Implementor** — executes on approved design, calls `artifact_seal` on impl-complete marker, calls `workflow_transition(AWAITING_COUNCIL_REVIEW)`. Works on feature branches only. Never touches `main`.

**Council** — reviews both design (AWAITING_DESIGN_REVIEW) and implementation (AWAITING_COUNCIL_REVIEW). Raises findings with P0/P1/P2/P3 severity. P0/P1 must include realistic trigger conditions, not theoretical scenarios. For design review: calls `workflow_transition(PLANNING)` to return findings. For implementation review: calls `workflow_transition(IMPLEMENTING)` on findings or `workflow_transition(VALIDATING)` on clear.

**Validator** — verifies `artifact_verify` on contract before running. Asserts only on delta scope (files touched by PR). Calls `workflow_transition(RETRO)` on pass or `workflow_transition(IMPLEMENTING)` on regression.

**Retro** — documents what worked, what didn't, any carry-forward risks. Calls `workflow_transition(AWAITING_MERGE)`.

Write `SKILL.md` for the workflow-protocol skill with the full state machine reference so it is available to all agents on demand.

---

## Step 3 — First Planning Cycle

Once the repo and workflow are initialised, begin the first development cycle as Planner.

**First feature target:** Minimal working enforcement — the smallest surface that makes discipline optional.

Scope:
- XState statechart with all states and valid transitions defined
- `workflow_transition` tool — guard evaluation + state write
- `artifact_seal` and `artifact_verify` tools — SHA-256 implementation
- `workflow-gate.ts` pre-hook — intercepts and blocks on invalid state
- `workflow_status` tool — readable current state
- `/workflow` slash command — `status` subcommand only for Phase 1
- State persisted correctly to `.omp/workflow/state.json`

Out of scope for Phase 1:
- TTSR rules
- Full slash command suite (approve, reset)
- Skills discovery integration
- Multi-project support

Run Planner-Council review on the design doc before sealing. Council should specifically check:
- Are guard conditions sufficient to prevent the four known failure modes?
- Is the hook intercept surface complete — are there tool calls that imply role actions but aren't covered?
- Does the contract delta-scope rule hold in the Validator role definition?

Seal the design doc and validation contract, call `workflow_transition(AWAITING_DESIGN_REVIEW)` for Council design review. After Council clears, record council_signoff, transition to `AWAITING_OPERATOR_APPROVAL`, and surface for operator review before implementation begins.

---

## Known Failure Modes Being Fixed

| Failure | Root Cause | Fix |
|---|---|---|
| Validator asserts repo-wide zero errors | Contract written too broadly | Guard requires delta-scoped contracts; contract authorship enforced by Planner at seal |
| Planner-Council design review skipped | Not a formal state | `AWAITING_DESIGN_REVIEW` is now a formal state with bidirectional transitions; guard requires Council sign-off + no open P0/P1 design findings |
| Council severity inflation | No realistic-conditions requirement | Council role definition requires trigger conditions on all P0/P1 findings |
| Agents skip steps or misroute | Discipline-only enforcement | Transitions blocked by `workflow-gate.ts` hook without valid state |

---

## State File Schema

`.omp/workflow/state.json`:

```json
{
  "state": "PLANNING",
  "previous_state": null,
  "current_pr": null,
  "feature_branch": null,
  "artifacts": {},
  "council_sign_off": null,
  "operator_approval": null,
  "findings_open": [],
  "transitioned_at": null,
  "transitioned_by": null
}
```

All transitions write to this file atomically. The hook reads it before allowing role-implying tool calls.

---

## Constraints

- TypeScript throughout — matches omp's native runtime (Bun)
- XState v5 — not v4
- No runtime dependencies beyond `xstate` — SHA-256 via Node `crypto` built-in
- Tools must return structured JSON — not prose — so hooks can parse results programmatically
- Operator approval is a manual step: the `/workflow approve` command writes to state; no agent can self-approve

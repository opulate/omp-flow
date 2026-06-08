<p align="center">
  <strong>Mechanically enforced agentic workflow for omp.</strong>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&colorA=222222&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat&colorA=222222" alt="Bun"></a>
  <a href="https://stately.ai/docs/xstate-v5"><img src="https://img.shields.io/badge/XState-v5-5C2D91?style=flat&colorA=222222" alt="XState v5"></a>
  <a href="https://github.com/opulate/omp-flow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-58A6FF?style=flat&colorA=222222" alt="License"></a>
</p>

<p align="center">
  A pure <code>.omp/</code> extension that turns the 5-role development workflow into a state machine.<br>
  State-machine-gated role transitions with SHA-256 artifact integrity.<br>
  Zero harness modifications — drop it in and the guard rails go up.
</p>

---

## The problem

The 5-role workflow (Planner → Implementor ↔ Council → Validator → Retro) relies on agent discipline.
Under complexity, discipline degrades. Agents skip Council, proceed with untouched artifacts,
write validation contracts that assert repo-wide zero errors, and misroute transitions.

**omp-flow makes discipline mechanical.** An agent cannot proceed without passing a verified guard.

---

## 01 · State-machine-gated transitions

Every role transition is a guard-evaluated state change. The XState v5 statechart has **10 states**
and **11 valid transitions**. Call `workflow_transition` — if the guard fails, you get a structured
error telling you exactly what's missing. No prose, no ambiguity.

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

## 02 · Artifact integrity you can verify

Every artifact is sealed with SHA-256. Before a transition, the guard recomputes the hash and
compares it against the stored record. A modified artifact fails the gate. No tampering possible
between seal and verify.

| Key | Sealed by | Verified at |
|---|---|---|
| `design-doc` | Planner | PLANNING → APPROVAL, Council review |
| `validation-contract` | Planner | APPROVAL → IMPLEMENTING, Validator start |
| `impl-complete` | Implementor | IMPLEMENTING → COUNCIL |
| `council-report` | Council | COUNCIL → VALIDATING |
| `validation-report` | Validator | VALIDATING → RETRO |
| `retro-doc` | Retro | RETRO → AWAITING_MERGE |

## 03 · Pre-hook enforcement at the tool level

The `workflow-gate` pre-hook intercepts tool calls that imply role actions and blocks on invalid
state. It's not advisory — it's a hard block with a reason the agent can read and act on.

| State | What's blocked |
|---|---|
| `DONE` | Everything except `workflow_status` |
| `IMPLEMENTING` | Git operations targeting `main` |
| `AWAITING_COUNCIL_REVIEW` | Code modifications (`write`, `edit`, `ast_edit`) |
| `VALIDATING` | Code modifications |
| `BLOCKED` | Everything except `workflow_status` and `workflow_transition` |

## 04 · Four failure modes, mechanically prevented

| Failure | Cause | Fix |
|---|---|---|
| Validator asserts repo-wide zero errors | Contract written too broadly | Guard requires delta-scoped contracts; contract authorship enforced by Planner at seal |
| Planner-Council review skipped | Not a formal state | `PLANNING → APPROVAL` guard requires Council sign-off in state |
| Council severity inflation | No realistic-conditions requirement | All P0/P1 findings must include trigger conditions — "could theoretically happen" is blocked |
| Agents skip steps or misroute | Discipline-only enforcement | Transitions blocked by pre-hook without valid state |

## 05 · Role definitions the agent actually reads

Five role definitions live in `.omp/agents/` — one file per role. Each defines responsibilities,
guard checklists, workflow states, and anti-patterns. The `SKILL.md` in `.omp/skills/workflow-protocol/`
is the full state machine reference, injectable on demand. Agents know the rules because the rules
are sitting right there.

## 06 · Four custom tools, one surface

| Tool | What it does |
|---|---|
| `workflow_transition` | Guard evaluation + atomic state write. Returns success or structured error. |
| `workflow_status` | Current state, artifact summaries, findings count, approval status. |
| `artifact_seal` | SHA-256 seal a file with a key. Recorded in state atomically. |
| `artifact_verify` | Recompute SHA-256 and compare. Pass/fail with both hashes. |

All tools return structured JSON. Hooks can parse results programmatically.

---

## Quick start

```sh
# Clone into an omp project
git clone https://github.com/opulate/omp-flow.git

# The .omp/ directory is auto-discovered by the omp harness
# Tools:    .omp/tools/<name>/index.ts → CustomToolFactory
# Hooks:    .omp/hooks/pre/<name>.ts   → HookAPI
# Skills:   .omp/skills/<name>/SKILL.md
# Commands: .omp/commands/<name>.md
# Agents:   .omp/agents/<name>.md

# Initialise the workflow for your project
# The state machine starts at PLANNING — begin your first cycle
```

## File structure

```
.omp/
  tools/                          Custom tools (auto-discovered)
    workflow-transition/index.ts    Guard eval + state transition
    workflow-status/index.ts        Read current state
    artifact-seal/index.ts          SHA-256 seal
    artifact-verify/index.ts        SHA-256 verify
  hooks/pre/
    workflow-gate.ts                Pre-hook intercept
  commands/
    workflow.md                     /workflow slash command
  agents/                           Role definitions
    planner.md · implementor.md · council.md · validator.md · retro.md
  skills/workflow-protocol/
    SKILL.md                        State machine reference
  workflow/
    state.json                      Persisted state (gitignored during dev)

src/
  state-machine/
    types.ts                        State, Context, Role, Finding types
    guards.ts                       Guard functions per transition
    machine.ts                      XState v5 statechart
  integrity/
    hash.ts                         SHA-256 via Node crypto
    state-persistence.ts            Atomic load/write to state.json
```

## Philosophy

omp-flow is a **pure extension** — it lives entirely in `.omp/` and never touches harness code.
It enforces discipline at the tool level because discipline that lives only in prompts evaporates
under load.

- Council is mandatory, not opt-in
- Contracts are delta-scoped by default
- Operator approval is a manual step — agents cannot self-approve
- Every transition is mechanical, not aspirational

---

## License

MIT. See [LICENSE](LICENSE).

_made for agents that stay on the rails_

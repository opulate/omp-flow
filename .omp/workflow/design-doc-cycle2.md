# Design Doc — Orchestrator + writeState Fix

## Issues
- #10: Orchestrator role — spawns Planners, auto-advances workflow
- #11: writeState bug — blocks DONE→PLANNING reset

## Module Map
- Modify: `state-persistence.ts` (artifact preservation check), `smoke-test.ts` (reset test)
- Create: `.omp/agents/orchestrator.md`

## Design Decisions
- Orchestrator is a role definition only — no state machine changes. Auto-advance is agent behavior.
- writeState fix: check if transition is a RESET before enforcing artifact preservation.

# Implementation Complete — Phase 3

**Feature:** Hardening — artifact preservation, tool/machine unification, council sign-off tool, state history, DONE reset.
**Date:** 2026-06-08

## Changes

### Source files (6 changed + 1 new scope declaration)
- `src/state-machine/types.ts` — StateTransition interface, state_history field, schema_version → 3
- `src/state-machine/machine.ts` — trans()/blk()/doneReset()/resetTrans() helpers, DONE RESET handler, state_history in all assign actions
- `src/state-machine/guards.ts` — no changes
- `src/integrity/state-persistence.ts` — writeState() artifact validation, transitionState() helper, v2→v3 migration
- `src/integrity/hash.ts` — no changes (scope miss from Phase 2, declared in contract)

### Tool files (2 changed)
- `.omp/tools/workflow-transition/index.ts` — actor.send() single mutation path, GUARD_MAP removed, council_signoff action, DONE reset
- `.omp/tools/workflow-status/index.ts` — state_history display in text + details

### Docs (2 changed)
- `.omp/commands/workflow.md` — council-signoff subcommand, Phase 3 summary
- `.omp/skills/workflow-protocol/SKILL.md` — state_history docs, artifact preservation, cycle lifecycle

## Verification
- `bun run typecheck` — passes
- `bun run src/state-machine/smoke-test.ts` — 109/109 pass
- No regression: all 109 tests pass (up from 106 in Phase 2)

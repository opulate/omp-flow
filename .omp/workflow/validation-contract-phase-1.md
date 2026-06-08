# Validation Contract — Phase 1

## Scope: Delta only

Files touched in this Phase:
- src/state-machine/types.ts
- src/state-machine/guards.ts
- src/state-machine/machine.ts
- src/integrity/hash.ts
- src/integrity/state-persistence.ts
- .omp/tools/*/index.ts (4 tools)
- .omp/hooks/pre/workflow-gate.ts

## Assertions

1. `bun run typecheck` passes on the above files
2. `bun run src/state-machine/smoke-test.ts` passes (33 assertions)
3. `.omp/workflow/state.json` parseable and contains valid state
4. No file outside the delta scope is modified
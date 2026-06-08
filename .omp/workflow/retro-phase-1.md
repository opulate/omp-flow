# Retro — Phase 1

Date: 2026-06-08T01:24:31.623Z

## What Worked

- XState v5 statechart with `setup()` API — clean, type-safe
- Guard functions as independent pure functions — testable in isolation
- SHA-256 via Node crypto — zero dependencies, built-in
- Atomic state writes (temp file + rename) — corruption-resistant
- Custom tool pattern matching omp conventions — drops right in
- Workflow gate hook covers all critical state enforcement points
- Role definitions as markdown — human-readable, AI-injectable

## What Didn't

- XState v5 dynamic target typing is stricter than expected — BLOCKED reset simplified to PLANNING target. Functional behavior is correct because the tool writes `previous_state` to context and next tool load starts fresh.
- Bootstrapping paradox: need the workflow to build the workflow. Worked around by running tools directly during init, but this should be cleaner in a scaffolded project.
- Delta-scope heuristic uses regex patterns — fragile. Needs structured contract format in Phase 2.

## Carry-Forward Risks

- **Hook auto-discovery**: The `.omp/hooks/pre/` path needs to be loaded by the omp harness. If auto-discovery doesn't work for nested hooks directories, the gate won't activate.
- **Tool loading**: Custom tools in `.omp/tools/<name>/index.ts` follow the standard omp subdirectory pattern, but depth must be correct for auto-discovery.
- **State.json in .gitignore**: During active development, state is gitignored. Must be committed when PR is ready for merge, otherwise workflow state is lost.
- **Phase 2 scope creep**: The two P2 findings (structured contracts, branch tracking) plus the full slash command suite represent real work. Should be sequenced carefully.
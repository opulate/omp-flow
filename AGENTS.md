# omp-flow — Agent Instructions

## Role Definitions

Your role is defined in `.omp/agents/`. When the workflow assigns you a role (Planner, Implementor, Council, Validator, Retro), read the corresponding agent file for your responsibilities and available tools.

## Workflow Protocol

The full state machine reference is available in `.omp/skills/workflow-protocol/SKILL.md`. All agents can access this on demand.

## Key Rules

- Never transition state without passing the guard condition.
- Never modify a sealed artifact — the hash will fail verification.
- Council review is mandatory after implementation.
- Validation contracts must be delta-scoped (touched files only, not repo-wide).
- Operator approval is manual — agents cannot self-approve transitions.

## Skills

Three skills govern the workflow at specific trigger points:
- `grill-me` — invoked by Planner at the start of every planning cycle for structured alignment
- `red-green-refactor` — invoked by Implementor at the start of every implementation cycle for TDD
- `improve-codebase-architecture` — invoked by Planner during the module map step to identify shallow module clusters

## Issue Management

Issues are managed on GitHub via `gh issue create`, not as local markdown files. Every issue is a vertical slice with a test_boundary, tagged afk or hitl, with blocking relationships expressed in the body.

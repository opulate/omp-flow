# omp-flow v2 Design Document

## Summary

v2 extends the omp-flow 5-role workflow with three new skills (grill-me, red-green-refactor, improve-codebase-architecture), surgical edit enforcement at the tool level, per-issue cycle mechanics, and GitHub Issues as the canon planning board. The XState statechart (10 states, 11 transitions) is unchanged.

## Issue Board

9 issues in `.omp/workflow/issues/` ready for `gh issue create`:

| # | Title | Blocked By |
|---|-------|-----------|
| 1 | State machine context extension | none |
| 2 | Surgical edit pre-hook | none |
| 3 | Three new skills | none |
| 4 | Planner role update | #3 |
| 5 | Implementor role update | #3 |
| 6 | Council role update | none |
| 7 | Workflow protocol SKILL.md update | #1, #3 |
| 8 | Slash command verify | none |
| 9 | AGENTS.md and README update | #3 |

Run `.omp/workflow/issues/create-issues.sh` after `gh auth login` to create all issues on GitHub.

## Module Map

See inline module map in planning output. Summary:
- 3 new files (skills)
- 11 files modified (types, persistence, machine, hook, agents, command, protocol, AGENTS, README)
- 0 files deleted

## Planner-Council Review

All 9 issues pass review: test boundaries present, vertical slices confirmed, blocking relationships correct, AFK tagging appropriate, no P0/P1 findings.

## Out of Scope

- Changing the XState statechart
- Modifying harness code (`.omp/` only)
- Implementing the new skills in code (they are procedural instructions)

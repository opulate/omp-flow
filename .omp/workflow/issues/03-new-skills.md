## Summary
Create three new skill definitions: `grill-me` (alignment interview protocol), `red-green-refactor` (TDD protocol), and `improve-codebase-architecture` (module structure analysis).

## Scope
- `.omp/skills/grill-me/SKILL.md` — new: Structured alignment session. AI interviews operator relentlessly about a brief, one question at a time, with its own recommendation per question, until shared understanding is reached. Output is a PRD (destination document, not a spec). Invoked at the start of every new planning cycle before module map or issues.
- `.omp/skills/red-green-refactor/SKILL.md` — new: TDD protocol for Implementor. Write failing test first → confirm red (run test suite) → implement → confirm green (test + typecheck pass) → only then seal impl-complete. Encodes anti-cheating guarantee: tests written before implementation cannot confirm the implementation.
- `.omp/skills/improve-codebase-architecture/SKILL.md` — new: Scans codebase for shallow module clusters (many small functions each with narrow test boundary) and proposes consolidation into deep modules (small interface, rich internals, single test boundary). Run by Planner during module map step.

## Test boundary
Each SKILL.md is a self-contained markdown document — validation is that the file exists at the expected path, can be read by agents, and contains the required protocol sections.

## Out of scope
- Implementing the skill mechanics in code (they are procedural instructions for agents, not executable code)
- Integration with any tool — skills are loaded by agents reading SKILL.md files

## Acceptance criteria
- `.omp/skills/grill-me/SKILL.md` exists with: purpose, invocation trigger, question-by-question protocol, recommendation format, PRD output description
- `.omp/skills/red-green-refactor/SKILL.md` exists with: red-green-refactor cycle steps, anti-cheating guarantee explanation, seal precondition (test+typecheck must pass)
- `.omp/skills/improve-codebase-architecture/SKILL.md` exists with: scanning methodology, shallow vs deep module criteria, consolidation proposal format, when to run (Planner module map step)
- All three files are readable and well-structured markdown

## Blocked by
none

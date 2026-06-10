## Summary
Update AGENTS.md and README.md to reflect v2 desired state: new skills, GitHub-based issue management, and updated workflow descriptions.

## Scope
- `AGENTS.md`: Add references to three new skills (grill-me, red-green-refactor, improve-codebase-architecture) and their trigger points. Note that issues are managed on GitHub, not as local markdown files.
- `README.md`: Update "Planner seals design doc" → "Planner seals issue set." Add new skills section covering grill-me, red-green-refactor, improve-codebase-architecture. Update file structure tree to include new skill directories.

## Test boundary
Both files are documentation — verify they accurately reflect the v2 state by cross-referencing with the agent definitions and skills.

## Out of scope
- Rewriting the README from scratch
- Adding changelog (separate concern)
- Updating any other documentation files

## Acceptance criteria
- AGENTS.md references grill-me (planning cycle start), red-green-refactor (implementation cycle start), improve-codebase-architecture (Planner module map step)
- AGENTS.md notes issues are managed on GitHub via `gh issue create`
- README transition description line says "Planner seals issue set" not "design doc"
- README includes a new skills section listing the three new skills with one-line descriptions
- README file structure tree includes `.omp/skills/grill-me/`, `.omp/skills/red-green-refactor/`, `.omp/skills/improve-codebase-architecture/`

## Blocked by
#3 (skills must exist before they can be documented)

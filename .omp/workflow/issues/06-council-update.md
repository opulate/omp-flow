## Summary
Update the Council role definition with three new rejection criteria: horizontal slice detection, test quality verification via git history, and diff scope analysis.

## Scope
- `.omp/agents/council.md`: Add three new finding criteria:
  1. Horizontal slice rejection (P1): If an issue implements only one layer when a vertical slice is achievable, raise as P1 with trigger condition "this produces no testable feedback until downstream issues complete."
  2. Test quality check (P2): If tests were written after implementation (detectable via git history: implementation file modified before test file in same branch), raise as P2 — anti-cheating signal from broken TDD discipline.
  3. Diff scope signal (P2): If diff touches >40% of a file for a change that should have been ≤10 lines, raise as P2 with specific file and expected vs actual scope.
- Add note: Council receives coding standards pushed to it alongside impl-complete artifact — does not need to fetch them.

## Test boundary
The council agent reads `.omp/agents/council.md` for its protocol — verify the file contains all three new criteria with severity levels and trigger conditions.

## Out of scope
- Automated detection of horizontal slices (Council evaluates manually based on issue and implementation)
- Automated git history analysis (Council inspects via git log)
- Changing the Council review state machine flow

## Acceptance criteria
- Horizontal slice rejection documented as P1 with required trigger condition
- Test quality check documented as P2 with git history detection method
- Diff scope signal documented as P2 with 40% threshold and specific file reporting requirement
- Council receives coding standards via push note present
- All new criteria include realistic trigger conditions (required for P1 by existing guard)

## Blocked by
none

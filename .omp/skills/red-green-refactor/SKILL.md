# red-green-refactor

## Purpose

TDD protocol for the Implementor role. Enforces the discipline: write a failing test first, confirm it fails, implement, confirm it passes, then seal.

## When Invoked

At the start of every implementation cycle, by the Implementor role, before writing any production code.

## Protocol

### Step 1: Red
1. Write a failing test that asserts the desired behavior.
2. Run the test suite (`bun test` or `bun run <test-file>`) to confirm the test fails.
3. If the test passes without implementation, the test is wrong — rewrite it.

### Step 2: Green
1. Implement the minimal code needed to make the test pass.
2. Run `bun test && bun run typecheck` to confirm:
   - All tests pass (including the new one)
   - Typecheck passes with no errors
3. Both MUST pass before proceeding.

### Step 3: Refactor
1. Clean up the implementation without changing behavior.
2. Run `bun test && bun run typecheck` again to confirm nothing broke.
3. Tests stay green throughout.

### Step 4: Seal
1. Only after all three steps pass, call `artifact_seal(key="impl-complete")`.
2. The pre-hook will block the seal if tests or typecheck have not run in the current session.

## Anti-Cheating Guarantee

Tests written BEFORE implementation cannot confirm the implementation — they test behavior that doesn't exist yet. A test that passes before implementation is written is either:
- Testing existing behavior (not the new feature), or
- Written incorrectly (false positive)

Council can detect cheating via git history: if the implementation file was modified before the test file in the same branch, the TDD discipline was broken (P2 finding — test quality check).

## Anti-Patterns

- Writing implementation first, then tests to "cover" it (defeats the guarantee)
- Skipping the red confirmation step ("I'm sure it'll fail")
- Sealing impl-complete before both test and typecheck pass
- Writing tests that are too broad (testing existing behavior alongside new)

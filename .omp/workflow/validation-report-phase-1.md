# Validation Report — Phase 1

Date: 2026-06-08T01:24:06.313Z

## Contract Verification

Contract hash: a5facab1e70581b5dd784194f5c1c7ae55694ffe8b158b89ad7d3962fd07c4f8
Verified: MATCH

## Assertions

1. `bun run typecheck` — PASS
2. `bun run src/state-machine/smoke-test.ts` (33 assertions) — PASS
3. `.omp/workflow/state.json` parseable — FAIL
4. Delta-scope file check — PASS

## Result

Some assertions failed.
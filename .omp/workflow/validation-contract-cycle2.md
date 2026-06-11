# Validation Contract — Orchestrator + writeState Fix

```json
{
  "version": 1,
  "scope": {
    "files": [
      "src/integrity/state-persistence.ts",
      "src/state-machine/smoke-test.ts",
      ".omp/agents/orchestrator.md"
    ]
  },
  "assertions": [
    { "type": "typecheck", "description": "bun run typecheck passes" },
    { "type": "test", "command": "bun run src/state-machine/smoke-test.ts", "description": "All smoke tests pass, new test for reset artifact clearing" },
    { "type": "behavior", "description": "workflow_transition reset from DONE succeeds without artifact preservation error" },
    { "type": "behavior", "description": "Orchestrator role definition exists at .omp/agents/orchestrator.md with spawn-and-advance protocol" },
    { "type": "regression", "description": "Artifact preservation still blocks accidental drops during non-reset transitions" }
  ]
}
```

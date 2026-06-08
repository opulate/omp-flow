# Validation Contract — Phase 2

## Scope: Delta only

```json
{
  "version": 1,
  "scope": {
    "files": [
      "src/state-machine/types.ts",
      "src/state-machine/guards.ts",
      "src/state-machine/machine.ts",
      "src/integrity/state-persistence.ts",
      ".omp/tools/workflow-transition/index.ts",
      ".omp/tools/workflow-status/index.ts",
      ".omp/tools/artifact-verify/index.ts",
      ".omp/commands/workflow.md",
      ".omp/skills/workflow-protocol/SKILL.md",
      "src/state-machine/smoke-test.ts"
    ]
  },
  "assertions": [
    { "type": "typecheck", "description": "bun run typecheck passes on all scoped files" },
    { "type": "test", "command": "bun run src/state-machine/smoke-test.ts", "description": "All smoke test assertions pass, including new Phase 2 tests" },
    { "type": "structured-contract", "description": "New contracts use structured JSON format with scope.files and assertions" },
    { "type": "slash-commands", "description": "/workflow approve transitions from AWAITING_OPERATOR_APPROVAL to IMPLEMENTING and AWAITING_MERGE to DONE" },
    { "type": "slash-commands", "description": "/workflow reset transitions from BLOCKED to previous_state" },
    { "type": "bl-dynamic-target", "description": "BLOCKED reset restores previous_state, not hardcoded PLANNING" },
    { "type": "approval-audit", "description": "council_sign_off and operator_approval use ApprovalRecord with timestamp/identity/method" },
    { "type": "findings-visible", "description": "workflow_status returns findings_open array, not just count" },
    { "type": "first-run", "description": "workflow_status includes next_action guidance when PLANNING with no artifacts" },
    { "type": "bugfix", "description": "artifact-verify/index.ts parses correctly (missing }})" },
    { "type": "no-extra-files", "description": "No file outside declared scope is modified" }
  ]
}
```

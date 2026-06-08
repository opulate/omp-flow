# Phase 3 Validation Contract

```json
{
  "version": 1,
  "scope": {
    "files": [
      "src/state-machine/types.ts",
      "src/state-machine/machine.ts",
      "src/state-machine/guards.ts",
      "src/state-machine/smoke-test.ts",
      "src/integrity/state-persistence.ts",
      "src/integrity/hash.ts",
      ".omp/tools/workflow-transition/index.ts",
      ".omp/tools/workflow-status/index.ts",
      ".omp/commands/workflow.md",
      ".omp/skills/workflow-protocol/SKILL.md"
    ]
  },
  "assertions": [
    {
      "type": "typecheck",
      "description": "bun run typecheck passes on all scoped files"
    },
    {
      "type": "test",
      "command": "bun run src/state-machine/smoke-test.ts",
      "description": "All 106 existing smoke tests pass; new assertions cover artifact preservation, tool/machine unification, council_signoff action, and state_history"
    },
    {
      "type": "no-extra-files",
      "description": "No file outside declared scope is modified"
    },
    {
      "type": "behavior",
      "description": "writeState() throws when artifacts would be lost (partial context write)"
    },
    {
      "type": "behavior",
      "description": "transitionState() helper preserves all artifacts across transition chains"
    },
    {
      "type": "behavior",
      "description": "workflow_transition uses actor.send() exclusively — GUARD_MAP removed, direct ctx.state mutation removed"
    },
    {
      "type": "behavior",
      "description": "council_signoff action records ApprovalRecord in PLANNING state; rejected from other states or non-Planner roles"
    },
    {
      "type": "behavior",
      "description": "state_history grows on each transition; v2→v3 migration preserves existing previous_state as first entry; caps at 50 entries"
    },
    {
      "type": "behavior",
      "description": "/workflow reset from DONE transitions to PLANNING, clears artifacts/approvals, archives findings to history"
    },
    {
      "type": "regression",
      "description": "All existing guards enforced: structured contract validation, branch protection, hash integrity, approval audit trail, trigger conditions on P0/P1 findings"
    }
  ]
}
```

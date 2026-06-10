# Validation Contract — omp-flow v2

```json
{
  "version": 1,
  "scope": {
    "files": [
      "src/state-machine/types.ts",
      "src/integrity/state-persistence.ts",
      "src/state-machine/machine.ts",
      ".omp/hooks/pre/workflow-gate.ts",
      ".omp/agents/planner.md",
      ".omp/agents/implementor.md",
      ".omp/agents/council.md",
      ".omp/commands/workflow.md",
      ".omp/skills/workflow-protocol/SKILL.md",
      ".omp/skills/grill-me/SKILL.md",
      ".omp/skills/red-green-refactor/SKILL.md",
      ".omp/skills/improve-codebase-architecture/SKILL.md",
      "AGENTS.md",
      "README.md"
    ]
  },
  "assertions": [
    { "type": "typecheck", "description": "bun run typecheck passes on all scoped TypeScript files" },
    { "type": "test", "command": "bun test", "description": "All existing smoke tests pass, new tests added for context fields and hook behavior" },
    { "type": "file-exists", "description": "Three new SKILL.md files exist at expected paths" },
    { "type": "no-extra-files", "description": "No file outside declared scope is modified" }
  ]
}
```

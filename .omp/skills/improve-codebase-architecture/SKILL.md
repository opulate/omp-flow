# improve-codebase-architecture

## Purpose

Scans the codebase for shallow module clusters and proposes consolidation into deep modules. A deep module has a small interface, rich internals, and a single test boundary wrapping the whole unit.

## When Invoked

By the Planner role during the module map step, before scoping issues. Run at the start of every planning cycle.

## Protocol

### Step 1: Identify Shallow Clusters
Scan for modules that exhibit these patterns:
- Many small exported functions (5+ exports) each with a narrow, isolated test boundary
- Functions that are always called together but tested separately
- Modules where the test file is larger than the implementation file
- Modules where changing one function's signature forces test rewrites across many test files

### Step 2: Propose Deep Modules
For each identified cluster, propose consolidation:
- **Small interface**: Reduce exports to 1-3 public entry points
- **Rich internals**: Internal helpers become private, tested through the public interface
- **Single test boundary**: One test file wrapping the module's public API
- **Preserve behavior**: The consolidation must not change external behavior

### Step 3: Document Findings
Output a module structure report:
- Current state (shallow modules found)
- Proposed state (consolidated deep modules)
- Rationale (why each consolidation improves the architecture)
- Risk assessment (what could break, test coverage gaps)

### Step 4: Scope Issues
If consolidations are approved, scope them as issues in the planning cycle. Consolidations that touch code outside the current feature scope should be noted as out-of-scope for this cycle.

## Criteria

| Signal | Shallow Module | Deep Module |
|--------|---------------|-------------|
| Exports | 5+ public functions | 1-3 public entry points |
| Test boundary | Per-function tests | Single module-level test |
| Interface-to-implementation ratio | Implementation ≤ interface | Interface ≪ implementation |
| Change impact | Changing one function ripples to many test files | Internal changes don't touch tests |

## Anti-Patterns

- Proposing consolidations that change observable behavior
- Consolidating modules that serve different callers
- Adding abstraction layers instead of removing them
- Skipping the risk assessment ("it's obviously better")

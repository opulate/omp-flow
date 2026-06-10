# grill-me

## Purpose

Structured alignment session protocol. The AI interviews the operator relentlessly about a brief, one question at a time, with its own recommendation per question, until shared understanding is reached.

## When Invoked

At the start of every new planning cycle, before producing a module map or issues. Invoked by the Planner role.

## Protocol

1. **Read the brief** — absorb the desired state delta or feature request from the operator.
2. **Identify decision points** — extract every ambiguous or branching decision from the brief.
3. **Interview one question at a time** — present exactly one question, with:
   - The question itself (clear, concrete)
   - 2-5 options with tradeoffs described
   - Your recommended option (marked as "Recommended")
4. **Resolve each branch** — do not move to the next question until the operator responds.
5. **Repeat** — continue until every decision point has been resolved and shared understanding is reached.

## Output

A **PRD (Product Requirements Document)** — a destination document capturing the aligned understanding. The PRD is NOT a spec; it describes what is being built and why, not how to build it.

### PRD Format
- Summary (one paragraph)
- Decisions made (each question + operator's choice)
- Scope (what's in, what's out)
- Risks and assumptions
- Acceptance criteria (high-level, not test-level)

## Anti-Patterns

- Asking multiple questions at once (overwhelms the operator)
- Skipping recommendations (the AI must take a position)
- Producing a spec instead of a PRD (specs are for Implementation, PRDs are for alignment)
- Rushing to finish — every branch must be resolved

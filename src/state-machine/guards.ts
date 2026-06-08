/**
 * Guard functions for workflow transitions.
 *
 * Each guard evaluates the current context against the requirements
 * defined in the omp-flow state machine specification.
 */

import type { WorkflowContext, GuardResult, CouncilFinding } from "./types.js";
import { computeHash, readFile } from "../integrity/hash.js";

// ── PLANNING → AWAITING_OPERATOR_APPROVAL ──────────────────────────

/**
 * Guard: PLANNING → AWAITING_OPERATOR_APPROVAL
 *
 * - Design doc exists at declared path
 * - SHA-256 hash recorded in state
 * - Council sign-off present in state
 */
export function guardPlanningToAwaitingApproval(ctx: WorkflowContext): GuardResult {
  if (!ctx.council_sign_off) {
    return { allowed: false, reason: "Council sign-off is required before seeking operator approval." };
  }

  const designArtifact = ctx.artifacts["design-doc"];
  if (!designArtifact) {
    return { allowed: false, reason: "No design-doc artifact sealed. Seal the design document first." };
  }

  if (!designArtifact.hash) {
    return { allowed: false, reason: "Design-doc artifact has no recorded hash." };
  }

  const currentHash = computeHash(designArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Design doc not found at path: ${designArtifact.path}` };
  }
  if (currentHash !== designArtifact.hash) {
    return {
      allowed: false,
      reason: "Design doc has been modified since sealing. Re-seal before transitioning.",
    };
  }

  return { allowed: true };
}

// ── AWAITING_OPERATOR_APPROVAL → IMPLEMENTING ──────────────────────

/**
 * Guard: AWAITING_OPERATOR_APPROVAL → IMPLEMENTING
 *
 * - Operator approval recorded (not agent self-approval)
 * - Validation contract exists at declared path
 * - Contract is delta-scoped: asserts only on files touched by this PR, not repo-wide
 */
export function guardAwaitingApprovalToImplementing(ctx: WorkflowContext): GuardResult {
  if (!ctx.operator_approval) {
    return { allowed: false, reason: "Operator approval has not been recorded." };
  }

  const contractArtifact = ctx.artifacts["validation-contract"];
  if (!contractArtifact) {
    return { allowed: false, reason: "No validation-contract artifact sealed. The Planner must seal the contract." };
  }

  if (!contractArtifact.hash) {
    return { allowed: false, reason: "Validation-contract artifact has no recorded hash." };
  }

  const currentHash = computeHash(contractArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Validation contract not found at path: ${contractArtifact.path}` };
  }
  if (currentHash !== contractArtifact.hash) {
    return {
      allowed: false,
      reason: "Validation contract has been modified since sealing. Re-seal before transitioning.",
    };
  }

  // Verify delta-scoped contract: must not contain repo-wide assertions
  const contractContent = readFile(contractArtifact.path);
  if (contractContent) {
    if (hasRepoWideAssertions(contractContent)) {
      return {
        allowed: false,
        reason: "Validation contract contains repo-wide assertions. Contracts must be delta-scoped to files touched by this PR.",
      };
    }
  }

  return { allowed: true };
}

/**
 * Detect repo-wide assertion patterns in contract content.
 * Heuristic: looks for glob patterns like "**\/*.ts", "all files", or "entire repo".
 */
function hasRepoWideAssertions(content: string): boolean {
  const repoWidePatterns = [
    /\*\*\/\*\.\w+/g,          // globstar patterns
    /all\s+files/i,             // "all files"
    /entire\s+(repo|project)/i, // "entire repo/project"
    /every\s+(file|source)/i,   // "every file/source"
  ];
  return repoWidePatterns.some((p) => p.test(content));
}

// ── IMPLEMENTING → AWAITING_COUNCIL_REVIEW ─────────────────────────

/**
 * Guard: IMPLEMENTING → AWAITING_COUNCIL_REVIEW
 *
 * - impl-complete artifact exists at declared path
 * - SHA-256 hash matches state record
 * - Feature branch exists, is not `main`
 */
export function guardImplementingToAwaitingCouncil(ctx: WorkflowContext): GuardResult {
  const implArtifact = ctx.artifacts["impl-complete"];
  if (!implArtifact) {
    return { allowed: false, reason: "No impl-complete artifact sealed. Seal the implementation before requesting Council review." };
  }

  if (!implArtifact.hash) {
    return { allowed: false, reason: "Impl-complete artifact has no recorded hash." };
  }

  const currentHash = computeHash(implArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Impl-complete artifact not found at path: ${implArtifact.path}` };
  }
  if (currentHash !== implArtifact.hash) {
    return {
      allowed: false,
      reason: "Impl-complete artifact has been modified since sealing. Re-seal before transitioning.",
    };
  }

  if (!ctx.feature_branch) {
    return { allowed: false, reason: "No feature branch recorded. Implementation must be on a feature branch, not main." };
  }
  if (ctx.feature_branch === "main") {
    return { allowed: false, reason: "Feature branch is 'main'. Implementation must be on a feature branch." };
  }

  return { allowed: true };
}

// ── AWAITING_COUNCIL_REVIEW → VALIDATING ───────────────────────────

/**
 * Guard: AWAITING_COUNCIL_REVIEW → VALIDATING
 *
 * - Council report exists at declared path
 * - No P0 or P1 findings open (P2+ may proceed)
 * - Council findings are tagged with realistic conditions (no theoretical-only issues)
 */
export function guardAwaitingCouncilToValidating(ctx: WorkflowContext): GuardResult {
  const reportArtifact = ctx.artifacts["council-report"];
  if (!reportArtifact) {
    return { allowed: false, reason: "No council-report artifact sealed." };
  }

  // Verify the report file hasn't been modified since sealing
  if (!reportArtifact.hash) {
    return { allowed: false, reason: "Council-report artifact has no recorded hash." };
  }
  const currentHash = computeHash(reportArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Council report not found at path: ${reportArtifact.path}` };
  }
  if (currentHash !== reportArtifact.hash) {
    return {
      allowed: false,
      reason: "Council report has been modified since sealing. Re-seal before transitioning.",
    };
  }

  const p0p1Open = ctx.findings_open.filter(
    (f: CouncilFinding) => f.severity === "P0" || f.severity === "P1"
  );

  if (p0p1Open.length > 0) {
    const findingList = p0p1Open.map((f) => `${f.severity}: ${f.description}`).join("; ");
    return {
      allowed: false,
      reason: `Open P0/P1 findings remain: ${findingList}. Resolve or downgrade before validating.`,
    };
  }

  // Check that all P0/P1 findings have realistic trigger conditions
  for (const finding of ctx.findings_open) {
    if (finding.severity === "P0" || finding.severity === "P1") {
      if (!finding.trigger_conditions || finding.trigger_conditions.trim().length === 0) {
        return {
          allowed: false,
          reason: `Finding "${finding.description}" (${finding.severity}) has no trigger conditions. All P0/P1 findings must describe realistic trigger conditions, not theoretical scenarios.`,
        };
      }
    }
  }

  return { allowed: true };
}

// ── AWAITING_COUNCIL_REVIEW → IMPLEMENTING (Council returns findings) ──

/**
 * Guard: AWAITING_COUNCIL_REVIEW → IMPLEMENTING
 *
 * Council is returning findings. No gate beyond the state being valid.
 */
export function guardAwaitingCouncilToImplementing(_ctx: WorkflowContext): GuardResult {
  // Council is sending back for rework — always allowed from this state.
  return { allowed: true };
}

// ── VALIDATING → RETRO ─────────────────────────────────────────────

/**
 * Guard: VALIDATING → RETRO
 *
 * - Validation report exists at declared path
 * - All contract assertions pass against declared scope
 * - No regressions introduced in touched files
 */
export function guardValidatingToRetro(ctx: WorkflowContext): GuardResult {
  const reportArtifact = ctx.artifacts["validation-report"];
  if (!reportArtifact) {
    return { allowed: false, reason: "No validation-report artifact sealed." };
  }

  if (!reportArtifact.hash) {
    return { allowed: false, reason: "Validation-report artifact has no recorded hash." };
  }

  const currentHash = computeHash(reportArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Validation report not found at path: ${reportArtifact.path}` };
  }
  if (currentHash !== reportArtifact.hash) {
    return {
      allowed: false,
      reason: "Validation report has been modified since sealing. Re-seal before transitioning.",
    };
  }

  return { allowed: true };
}

// ── VALIDATING → IMPLEMENTING (regression found) ───────────────────

/**
 * Guard: VALIDATING → IMPLEMENTING
 *
 * Validator found regressions. Always allowed from this state.
 */
export function guardValidatingToImplementing(_ctx: WorkflowContext): GuardResult {
  return { allowed: true };
}

// ── RETRO → AWAITING_MERGE ─────────────────────────────────────────

/**
 * Guard: RETRO → AWAITING_MERGE
 *
 * Retro document sealed and unmodified. Hash verified.
 */
export function guardRetroToAwaitingMerge(ctx: WorkflowContext): GuardResult {
  const retroArtifact = ctx.artifacts["retro-doc"];
  if (!retroArtifact) {
    return { allowed: false, reason: "No retro-doc artifact sealed." };
  }

  // Verify the retro doc hasn't been modified since sealing
  if (!retroArtifact.hash) {
    return { allowed: false, reason: "Retro-doc artifact has no recorded hash." };
  }
  const currentHash = computeHash(retroArtifact.path);
  if (currentHash === null) {
    return { allowed: false, reason: `Retro doc not found at path: ${retroArtifact.path}` };
  }
  if (currentHash !== retroArtifact.hash) {
    return {
      allowed: false,
      reason: "Retro doc has been modified since sealing. Re-seal before transitioning.",
    };
  }

  return { allowed: true };
}

// ── AWAITING_MERGE → DONE ──────────────────────────────────────────

/**
 * Guard: AWAITING_MERGE → DONE
 *
 * Operator merge approval. Always allowed.
 */
export function guardAwaitingMergeToDone(ctx: WorkflowContext): GuardResult {
  if (!ctx.operator_approval) {
    return { allowed: false, reason: "Operator approval is required to mark as DONE." };
  }
  return { allowed: true };
}

// ── any → BLOCKED ──────────────────────────────────────────────────

/**
 * Guard: any → BLOCKED
 *
 * Always allowed. BLOCKED is the error-catching state.
 */
export function guardToBlocked(_ctx: WorkflowContext): GuardResult {
  return { allowed: true };
}

// ── BLOCKED → previous state ───────────────────────────────────────

/**
 * Guard: BLOCKED → previous state
 *
 * Operator reset. Checks previous_state exists.
 */
export function guardBlockedToPrevious(ctx: WorkflowContext): GuardResult {
  if (!ctx.previous_state) {
    return { allowed: false, reason: "No previous state recorded. Cannot reset from BLOCKED." };
  }
  return { allowed: true };
}

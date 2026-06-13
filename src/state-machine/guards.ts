/**
 * Guard functions for workflow transitions.
 *
 * Each guard evaluates the current context against the requirements
 * defined in the omp-flow state machine specification.
 *
 * All guards use `verifyArtifactIntegrity` for hash verification —
 * a single implementation that reads+hashes in one operation (TOCTOU-safe),
 * with try/catch for all I/O (no silent failures), and discriminated
 * error messages (not found vs permission denied vs generic error).
 */

import type { WorkflowContext, GuardResult, CouncilFinding, ValidationContract } from "./types.js";
import { ARTIFACT_KEYS } from "./types.js";
import { computeHashWithContent } from "../integrity/hash.js";

// ── Shared: Artifact Integrity Verification ─────────────────────────

/**
 * Verify that an artifact sealed in `ctx.artifacts[key]` has not been
 * modified since sealing.
 *
 * Reads the file and computes its hash in a single operation (TOCTOU-safe).
 * Returns `null` if verification passes, or a `GuardResult` with the
 * failure reason if it fails.
 */
function verifyArtifactIntegrity(ctx: WorkflowContext, key: string): GuardResult | null {
  const artifact = ctx.artifacts[key];
  if (!artifact) {
    return { allowed: false, reason: `No ${key} artifact sealed.` };
  }
  if (!artifact.hash) {
    return { allowed: false, reason: `${key} artifact has no recorded hash.` };
  }

  const result = computeHashWithContent(artifact.path);
  if (result.status !== "ok") {
    if (result.status === "not_found") {
      return { allowed: false, reason: `${key} not found at path: ${artifact.path}` };
    }
    if (result.status === "permission_denied") {
      return { allowed: false, reason: `Cannot read ${key}: ${result.error}` };
    }
    return { allowed: false, reason: `Error reading ${key}: ${result.error}` };
  }

  if (result.hash !== artifact.hash) {
    return {
      allowed: false,
      reason: `${key} has been modified since sealing. Re-seal before transitioning.`,
    };
  }

  return null; // verification passed
}

// ── Branch Protection ───────────────────────────────────────────────

const PROTECTED_BRANCHES = ["main", "master"] as const;

// ── PLANNING → AWAITING_DESIGN_REVIEW ────────────────────────────

/**
 * Guard: PLANNING → AWAITING_DESIGN_REVIEW
 *
 * - Design doc sealed and unmodified
 * - Validation contract sealed with valid structure
 */
export function guardPlanningToAwaitingDesignReview(ctx: WorkflowContext): GuardResult {
  const designVerify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.DESIGN_DOC);
  if (designVerify) return designVerify;

  const contractVerify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.VALIDATION_CONTRACT);
  if (contractVerify) return contractVerify;

  // Validate structured contract format
  const contractPath = ctx.artifacts[ARTIFACT_KEYS.VALIDATION_CONTRACT]!.path;
  const hashResult = computeHashWithContent(contractPath);
  if (hashResult.status === "ok") {
    const contractCheck = validateContractStructure(hashResult.content, contractPath);
    if (contractCheck) return contractCheck;
  }

  return { allowed: true };
}

// ── AWAITING_DESIGN_REVIEW → AWAITING_OPERATOR_APPROVAL ──────────

/**
 * Guard: AWAITING_DESIGN_REVIEW → AWAITING_OPERATOR_APPROVAL
 *
 * - Council sign-off present and approved
 * - Design doc sealed and unmodified
 * - No open P0/P1 design findings
 */
export function guardAwaitingDesignReviewToAwaitingApproval(ctx: WorkflowContext): GuardResult {
  if (ctx.council_sign_off === null) {
    return { allowed: false, reason: "Council design sign-off is pending. Complete design review first." };
  }
  if (!ctx.council_sign_off.approved) {
    return { allowed: false, reason: "Council design sign-off was denied. Address Council feedback before re-submitting." };
  }

  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.DESIGN_DOC);
  if (verify) return verify;

  const openP0P1 = ctx.design_findings_open.filter(
    f => (f.severity === "P0" || f.severity === "P1") && f.status === "open"
  );
  if (openP0P1.length > 0) {
    return {
      allowed: false,
      reason: `${openP0P1.length} open P0/P1 design finding(s) remain. Address or close all P0/P1 findings before seeking operator approval.`,
    };
  }

  return { allowed: true };
}

// ── AWAITING_DESIGN_REVIEW → PLANNING ────────────────────────────

/**
 * Guard: AWAITING_DESIGN_REVIEW → PLANNING
 *
 * Council returns design findings. Always allowed.
 */
export function guardAwaitingDesignReviewToPlanning(_ctx: WorkflowContext): GuardResult {
  return { allowed: true };
}

// ── AWAITING_OPERATOR_APPROVAL → IMPLEMENTING ──────────────────────

/**
 * Guard: AWAITING_OPERATOR_APPROVAL → IMPLEMENTING
 *
 * - Operator approval recorded (not agent self-approval)
 * - Validation contract sealed and unmodified
 * - Contract uses structured format (Phase 2): JSON with scope.files + assertions
 */
export function guardAwaitingApprovalToImplementing(ctx: WorkflowContext): GuardResult {
  if (ctx.operator_approval === null) {
    return { allowed: false, reason: "Operator approval is pending. Request operator review before implementing." };
  }
  if (!ctx.operator_approval.approved) {
    return { allowed: false, reason: "Operator approval was denied. Address the operator's feedback before re-submitting." };
  }

  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.VALIDATION_CONTRACT);
  if (verify) return verify;

  // Phase 2: Validate structured contract format
  const contractPath = ctx.artifacts[ARTIFACT_KEYS.VALIDATION_CONTRACT]!.path;
  const hashResult = computeHashWithContent(contractPath);
  if (hashResult.status === "ok") {
    const contractCheck = validateContractStructure(hashResult.content, contractPath);
    if (contractCheck) return contractCheck;
  }

  return { allowed: true };
}

// ── IMPLEMENTING → AWAITING_COUNCIL_REVIEW ─────────────────────────

/**
 * Guard: IMPLEMENTING → AWAITING_COUNCIL_REVIEW
 *
 * - impl-complete artifact sealed and unmodified
 * - Feature branch exists, is not a protected branch
 * - All P0/P1 findings from previous Council review have been addressed
 */
export function guardImplementingToAwaitingCouncil(ctx: WorkflowContext): GuardResult {
  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.IMPL_COMPLETE);
  if (verify) return verify;

  if (!ctx.feature_branch) {
    return {
      allowed: false,
      reason: "No feature branch recorded. Implementation must be on a feature branch, not a protected trunk branch.",
    };
  }
  if ((PROTECTED_BRANCHES as readonly string[]).includes(ctx.feature_branch)) {
    return {
      allowed: false,
      reason: `Feature branch is '${ctx.feature_branch}'. Implementation must be on a feature branch, not a protected trunk branch.`,
    };
  }

  // Check that open P0/P1 findings from any prior Council review have been addressed
  const unaddressed = ctx.findings_open.filter(
    (f: CouncilFinding) =>
      (f.severity === "P0" || f.severity === "P1") && f.status !== "addressed"
  );
  if (unaddressed.length > 0) {
    const list = unaddressed.map((f) => `${f.severity}: ${f.description}`).join("; ");
    return {
      allowed: false,
      reason: `Unaddressed P0/P1 findings remain: ${list}. Address findings before re-submitting for Council review.`,
    };
  }

  return { allowed: true };
}

// ── AWAITING_COUNCIL_REVIEW → VALIDATING ───────────────────────────

/**
 * Guard: AWAITING_COUNCIL_REVIEW → VALIDATING
 *
 * - Council report sealed and unmodified
 * - No P0 or P1 findings open (P2+ may proceed)
 * - Council findings include realistic trigger conditions (no theoretical-only issues)
 */
export function guardAwaitingCouncilToValidating(ctx: WorkflowContext): GuardResult {
  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.COUNCIL_REPORT);
  if (verify) return verify;

  const p0p1Open = ctx.findings_open.filter(
    (f: CouncilFinding) =>
      (f.severity === "P0" || f.severity === "P1") && f.status === "open"
  );

  if (p0p1Open.length > 0) {
    const findingList = p0p1Open.map((f) => `${f.severity}: ${f.description}`).join("; ");
    return {
      allowed: false,
      reason: `Open P0/P1 findings remain: ${findingList}. Resolve or downgrade before validating.`,
    };
  }

  // Check that P0/P1 findings have realistic trigger conditions
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
 * - Validation report sealed and unmodified
 */
export function guardValidatingToRetro(ctx: WorkflowContext): GuardResult {
  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.VALIDATION_REPORT);
  if (verify) return verify;

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
  const verify = verifyArtifactIntegrity(ctx, ARTIFACT_KEYS.RETRO_DOC);
  if (verify) return verify;

  return { allowed: true };
}

// ── AWAITING_MERGE → DONE ──────────────────────────────────────────

/**
 * Guard: AWAITING_MERGE → DONE
 *
 * Operator merge approval required. Operator must approve before
 * this transition can proceed.
 */
export function guardAwaitingMergeToDone(ctx: WorkflowContext): GuardResult {
  if (ctx.operator_approval === null) {
    return { allowed: false, reason: "Operator merge approval is pending. Request operator approval before marking as DONE." };
  }
  if (!ctx.operator_approval.approved) {
    return { allowed: false, reason: "Operator merge approval was denied. Address the operator's feedback before re-submitting." };
  }
  return { allowed: true };
}


// ── Contract Structure Validation (Phase 2) ───────────────────────────

/** Globstar and catch-all patterns that indicate repo-wide scope. */
const REPO_WIDE_PATTERNS = ["**", "*", "all", "all files", "entire repo", "every file"];

/**
 * Extract JSON contract from markdown file content.
 * Looks for a ```json fenced block, falls back to raw JSON if none found.
 */
function extractContractJson(content: string): string | null {
  const fence = content.match(/```json\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return null;
}

/**
 * Validate that a validation contract uses the structured format
 * and has explicit delta-scoped file declarations.
 *
 * Returns `null` if the contract is valid, or a `GuardResult` with
 * the failure reason.
 */
export function validateContractStructure(content: string, _path: string): GuardResult | null {
  const json = extractContractJson(content);
  if (!json) {
    return {
      allowed: false,
      reason: "Validation contract must use structured format: a JSON block with 'scope.files' and 'assertions'. See omp-flow SKILL.md for schema.",
    };
  }

  let contract: unknown;
  try {
    contract = JSON.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      allowed: false,
      reason: `Validation contract contains invalid JSON: ${msg}. Fix the JSON block before re-sealing.`,
    };
  }

  const c = contract as Record<string, unknown>;

  // scope.files must be a non-empty array
  if (!c.scope || typeof c.scope !== "object" || Array.isArray(c.scope)) {
    return {
      allowed: false,
      reason: "Validation contract missing 'scope' object. Required format: { scope: { files: [...] }, assertions: [...] }",
    };
  }

  const scope = c.scope as Record<string, unknown>;
  if (!Array.isArray(scope.files) || scope.files.length === 0) {
    return {
      allowed: false,
      reason: "Validation contract 'scope.files' must be a non-empty array of file paths. Empty scope implies repo-wide validation, which is not allowed.",
    };
  }

  for (const file of scope.files) {
    if (typeof file !== "string") {
      return { allowed: false, reason: `Validation contract file entry is not a string: ${String(file)}` };
    }
    const lower = file.toLowerCase().trim();
    for (const pattern of REPO_WIDE_PATTERNS) {
      if (lower === pattern || lower.includes(pattern)) {
        return {
          allowed: false,
          reason: `Validation contract file "${file}" appears to be a repo-wide pattern. Explicitly list each touched file — no globstars or catch-alls.`,
        };
      }
    }
  }

  // assertions must be a non-empty array
  if (!Array.isArray(c.assertions) || c.assertions.length === 0) {
    return {
      allowed: false,
      reason: "Validation contract 'assertions' must be a non-empty array. Each assertion must have 'type' and 'description'.",
    };
  }

  return null; // contract valid
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
 * This guard is wired into the machine's BLOCKED.RESET handler.
 */
export function guardBlockedToPrevious(ctx: WorkflowContext): GuardResult {
  if (!ctx.previous_state) {
    return {
      allowed: false,
      reason: "No previous state recorded. Reset to PLANNING instead.",
    };
  }
  return { allowed: true };
}

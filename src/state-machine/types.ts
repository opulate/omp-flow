/**
 * Workflow state and context types for the omp-flow state machine.
 */

// ── States ──────────────────────────────────────────────────────────
export type WorkflowState =
  | "PLANNING"
  | "AWAITING_OPERATOR_APPROVAL"
  | "IMPLEMENTING"
  | "AWAITING_COUNCIL_REVIEW"
  | "VALIDATING"
  | "RETRO"
  | "AWAITING_MERGE"
  | "DONE"
  | "ERROR"
  | "BLOCKED";

export const WORKFLOW_STATES: readonly WorkflowState[] = [
  "PLANNING",
  "AWAITING_OPERATOR_APPROVAL",
  "IMPLEMENTING",
  "AWAITING_COUNCIL_REVIEW",
  "VALIDATING",
  "RETRO",
  "AWAITING_MERGE",
  "DONE",
  "ERROR",
  "BLOCKED",
] as const;

// ── Transition Targets ──────────────────────────────────────────────
export type TransitionTarget =
  | "AWAITING_OPERATOR_APPROVAL"
  | "IMPLEMENTING"
  | "AWAITING_COUNCIL_REVIEW"
  | "VALIDATING"
  | "RETRO"
  | "AWAITING_MERGE"
  | "DONE"
  | "BLOCKED";

// ── Roles ───────────────────────────────────────────────────────────
export type Role = "Planner" | "Implementor" | "Council" | "Validator" | "Retro" | "Operator";

// ── Finding Severity ────────────────────────────────────────────────
export type FindingSeverity = "P0" | "P1" | "P2" | "P3";

// ── Council Finding ─────────────────────────────────────────────────
export interface CouncilFinding {
  severity: FindingSeverity;
  description: string;
  trigger_conditions: string; // Required for P0/P1 — must describe realistic trigger
  artifact_path: string;
}

// ── Artifact Record ─────────────────────────────────────────────────
export interface ArtifactRecord {
  path: string;
  hash: string;
  sealed_at: string;
  sealed_by: Role;
}

// ── Workflow Context (state.json schema) ────────────────────────────
export interface WorkflowContext {
  state: WorkflowState;
  previous_state: WorkflowState | null;
  current_pr: string | null;
  feature_branch: string | null;
  artifacts: Record<string, ArtifactRecord>;
  council_sign_off: boolean | null;
  operator_approval: boolean | null;
  findings_open: CouncilFinding[];
  transitioned_at: string | null;
  transitioned_by: Role | null;
}

// ── Initial Context Factory ─────────────────────────────────────────
export function createInitialContext(): WorkflowContext {
  return {
    state: "PLANNING",
    previous_state: null,
    current_pr: null,
    feature_branch: null,
    artifacts: {},
    council_sign_off: null,
    operator_approval: null,
    findings_open: [],
    transitioned_at: null,
    transitioned_by: null,
  };
}

// ── Guard Result ────────────────────────────────────────────────────
export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

// ── Tool Return Types ───────────────────────────────────────────────
export interface WorkflowStatusResult {
  state: WorkflowState;
  previous_state: WorkflowState | null;
  artifacts: Record<string, { path: string; sealed_at: string; sealed_by: Role }>;
  findings_open_count: number;
  council_sign_off: boolean | null;
  operator_approval: boolean | null;
  transitioned_at: string | null;
}

export interface ArtifactSealResult {
  key: string;
  path: string;
  hash: string;
  sealed_at: string;
}

export interface ArtifactVerifyResult {
  key: string;
  path: string;
  match: boolean;
  stored_hash: string | null;
  computed_hash: string;
}

export interface WorkflowTransitionResult {
  success: boolean;
  from: WorkflowState;
  to: WorkflowState | null;
  error?: string;
}

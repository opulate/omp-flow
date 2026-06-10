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
// Valid targets for workflow_transition; excludes initial + error states.
export type TransitionTarget = Exclude<WorkflowState, "PLANNING" | "ERROR">;

// ── Roles ───────────────────────────────────────────────────────────
export type Role = "Planner" | "Implementor" | "Council" | "Validator" | "Retro" | "Operator";

// ── Finding Severity ────────────────────────────────────────────────
export type FindingSeverity = "P0" | "P1" | "P2" | "P3";

// ── Artifact Keys ───────────────────────────────────────────────────
// Canonical artifact keys. Use these constants everywhere — never raw strings.
export const ARTIFACT_KEYS = {
  DESIGN_DOC: "design-doc",
  VALIDATION_CONTRACT: "validation-contract",
  IMPL_COMPLETE: "impl-complete",
  COUNCIL_REPORT: "council-report",
  VALIDATION_REPORT: "validation-report",
  RETRO_DOC: "retro-doc",
} as const;
export type ArtifactKey = (typeof ARTIFACT_KEYS)[keyof typeof ARTIFACT_KEYS];

// ── Finding Status ──────────────────────────────────────────────────
export type FindingStatus = "open" | "addressed" | "closed";

// ── Council Finding (with lifecycle) ────────────────────────────────
export interface CouncilFinding {
  id: string; // UUID
  severity: FindingSeverity;
  description: string;
  trigger_conditions: string; // Required for P0/P1 — must describe realistic trigger
  artifact_path: string;
  status: FindingStatus;
  raised_at: string;
  addressed_at?: string;
  addressed_in?: string; // impl-complete hash reference
}

// ── Artifact Record ─────────────────────────────────────────────────
export interface ArtifactRecord {
  path: string;
  hash: string;
  sealed_at: string;
  sealed_by: Role;
}

// ── Approval Record ──────────────────────────────────────────────────
/** Structured approval record replacing bare booleans (Phase 2). */
export interface ApprovalRecord {
  approved: boolean;
  approved_by: Role;
  approved_at: string;
  method: "slash-command" | "state-edit" | "tool-call";
}

// ── State Transition Record ──────────────────────────────────────────
/** Immutable record of a single workflow state transition. */
export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  at: string;          // ISO timestamp
  by: Role;
  reason?: string;     // populated for BLOCKED transitions
}

// ── Workflow Context (state.json schema) ────────────────────────────
export interface WorkflowContext {
  schema_version: number;
  state: WorkflowState;
  state_history: StateTransition[];  // v3: replaces single previous_state
  previous_state: WorkflowState | null;  // retained for backward compat, derived from state_history tail
  current_pr: string | null;
  feature_branch: string | null;
  artifacts: Record<string, ArtifactRecord>;
  council_sign_off: ApprovalRecord | null;
  operator_approval: ApprovalRecord | null;
  findings_open: CouncilFinding[];
  findings_history: CouncilFinding[];
  block_reason: string | null;
  transitioned_at: string | null;
  transitioned_by: Role | null;
  // v2: per-issue cycle tracking
  current_issue: number | null;
  issue_board_url: string | null;
  prd_summary: string | null;
 }

// ── Initial Context Factory ─────────────────────────────────────────
export function createInitialContext(): WorkflowContext {
  return {
    schema_version: 3,
    state: "PLANNING",
    state_history: [],
    previous_state: null,
    current_pr: null,
    feature_branch: null,
    artifacts: {},
    council_sign_off: null,
    operator_approval: null,
    findings_open: [],
    findings_history: [],
    block_reason: null,
    transitioned_at: null,
    transitioned_by: null,
    current_issue: null,
    issue_board_url: null,
    prd_summary: null,
   };
 }

// ── Guard Result ────────────────────────────────────────────────────
export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

// ── Hash Result (discriminated) ─────────────────────────────────────
export type HashResult =
  | { status: "ok"; hash: string; content: string }
  | { status: "not_found" }
  | { status: "permission_denied"; error: string }
  | { status: "error"; error: string };


// ── Validation Contract (Phase 2 structured format) ──────────────────
/** Structured validation contract — machine-verifiable format. */
export interface ValidationContract {
  version: number;
  scope: {
    files: string[];
  };
  assertions: ContractAssertion[];
}

export interface ContractAssertion {
  type: string;
  description: string;
  command?: string;
}
// ── Tool Return Types ───────────────────────────────────────────────
export interface WorkflowStatusResult {
  state: WorkflowState;
  previous_state: WorkflowState | null;
  artifacts: Record<string, { path: string; sealed_at: string; sealed_by: Role }>;
  findings_open: CouncilFinding[];
  block_reason: string | null;
  council_sign_off: ApprovalRecord | null;
  operator_approval: ApprovalRecord | null;
  transitioned_at: string | null;
  available_transitions: TransitionTarget[];
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

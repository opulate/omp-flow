/**
 * State persistence — read and write .omp/workflow/state.json.
 *
 * Schema validation on load prevents corrupted or tampered state from
 * bypassing workflow enforcement. On corruption, the original file is
 * preserved for forensic recovery — we never silently destroy state.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkflowContext, StateTransition } from "../state-machine/types.js";
import { createInitialContext, WORKFLOW_STATES, type ApprovalRecord, type Role } from "../state-machine/types.js";

const STATE_PATH = resolve(".omp/workflow/state.json");

/** Load current workflow state. Creates default if file doesn't exist. */
export function loadState(): WorkflowContext {
  if (!existsSync(STATE_PATH)) {
    const initial = createInitialContext();
    writeState(initial);
    return initial;
  }

  const raw = readFileSync(STATE_PATH, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    // Malformed JSON — preserve evidence, do not silently overwrite
    const msg = err instanceof Error ? err.message : String(err);
    backupCorruptedState(raw);
    throw new Error(
      `Workflow state file is corrupted (invalid JSON: ${msg}). ` +
        `A backup was saved. Restore from backup or delete state.json to start fresh.`
    );
  }

  if (!isValidWorkflowContext(parsed)) {
    backupCorruptedState(raw);
    throw new Error(
      "Workflow state file failed schema validation. " +
        "A backup was saved. Restore from backup or delete state.json to start fresh."
    );
  }

  const p = parsed as Record<string, unknown>;

  // Schema migration: v1/v2 → v3
  const version = typeof p.schema_version === "number" ? p.schema_version : 1;

  let council_sign_off = (p.council_sign_off as WorkflowContext["council_sign_off"]) ?? null;
  let operator_approval = (p.operator_approval as WorkflowContext["operator_approval"]) ?? null;

  if (version < 2) {
    // Migrate bare boolean approvals to ApprovalRecord
    council_sign_off = migrateApproval(p.council_sign_off);
    operator_approval = migrateApproval(p.operator_approval);
  }

  const migratedV2 = version < 2;
  const migratedV3 = version < 3;
  const migratedV4 = version < 4;

  // v2→v3: initialize state_history from previous_state if present
  let stateHistory: StateTransition[] = [];
  if (migratedV3 && p.previous_state && p.state) {
    stateHistory = [{
      from: p.previous_state as StateTransition["from"],
      to: p.state as StateTransition["to"],
      at: typeof p.transitioned_at === "string" ? p.transitioned_at : "unknown",
      by: (typeof p.transitioned_by === "string" ? p.transitioned_by : "unknown") as StateTransition["by"],
    }];
  } else if (Array.isArray(p.state_history)) {
    stateHistory = p.state_history as StateTransition[];
  }
  const result: WorkflowContext = {
    schema_version: migratedV2 || migratedV3 || migratedV4 ? 4 : version,
    state: (p.state as WorkflowContext["state"]) ?? "PLANNING",
    state_history: stateHistory,
    previous_state: (p.previous_state as WorkflowContext["previous_state"]) ?? null,
    current_pr: (p.current_pr as WorkflowContext["current_pr"]) ?? null,
    feature_branch: (p.feature_branch as WorkflowContext["feature_branch"]) ?? null,
    artifacts: (p.artifacts as WorkflowContext["artifacts"]) ?? {},
    council_sign_off,
    operator_approval,
    findings_open: (p.findings_open as WorkflowContext["findings_open"]) ?? [],
    design_findings_open: (p.design_findings_open as WorkflowContext["design_findings_open"]) ?? [],
    design_findings_history: (p.design_findings_history as WorkflowContext["design_findings_history"]) ?? [],
    findings_history: (p.findings_history as WorkflowContext["findings_history"]) ?? [],
    block_reason: (p.block_reason as WorkflowContext["block_reason"]) ?? null,
    transitioned_at: (p.transitioned_at as WorkflowContext["transitioned_at"]) ?? null,
    transitioned_by: (p.transitioned_by as WorkflowContext["transitioned_by"]) ?? null,
    current_issue: typeof p.current_issue === "number" ? p.current_issue : null,
    issue_board_url: typeof p.issue_board_url === "string" ? p.issue_board_url : null,
    prd_summary: typeof p.prd_summary === "string" ? p.prd_summary : null,
   };
 

  // Persist migration so the file is always current schema version
  if (migratedV2 || migratedV3 || migratedV4) {
    writeState(result);
  }

  return result;
}

/** Persist workflow state. Writes atomically via temp file + rename.
 *
 * Validates that in-flight artifacts are preserved before writing.
 * Throws if the context would drop artifacts present in the on-disk state. */
export function writeState(ctx: WorkflowContext): void {
  // Layer 1: artifact preservation — refuse to write if artifacts would be lost.
  // Skip for PLANNING state (reset transitions intentionally clear artifacts).
  if (ctx.state !== "PLANNING" && existsSync(STATE_PATH)) {
    try {
      const onDisk = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as Record<string, unknown>;
      const onDiskArtifacts = (onDisk.artifacts as Record<string, unknown>) ?? {};
      const ctxArtifacts = (ctx.artifacts as Record<string, unknown>) ?? {};
      const missing = Object.keys(onDiskArtifacts).filter(k => !(k in ctxArtifacts));
      if (missing.length > 0) {
        throw new Error(
          `Refusing to write state: ${missing.length} artifact(s) would be lost: ${missing.join(", ")}. ` +
          `Ensure the caller used loadState() before modifying context.`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Refusing to write state")) throw err;
      // If on-disk state is unreadable, proceed — the corruption recovery path handles this
    }
  }

  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(ctx, null, 2);
  const tmp = resolve(dir, `.state-tmp-${randomUUID()}.json`);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, STATE_PATH);
}

// ── Transition Helper ─────────────────────────────────────────────────

/** Encapsulate loadState() → modify → writeState() pattern.
 *
 * Layer 2 defense: makes the correct pattern the obvious path.
 * Callers that construct partial contexts without loadState() stand out.
 *
 * Returns the new state string on success. */
export function transitionState(
  role: Role,
  target: string,
  reason?: string,
): string {
  const ctx = loadState();
  const previousState = ctx.state;

  // Append to state history
  const entry: StateTransition = {
    from: previousState,
    to: target as StateTransition["to"],
    at: new Date().toISOString(),
    by: role,
  };
  if (reason) entry.reason = reason;

  ctx.state_history = [...(ctx.state_history ?? []), entry];
  // Keep last 50 entries to bound growth
  if (ctx.state_history.length > 50) {
    ctx.state_history = ctx.state_history.slice(-50);
  }

  ctx.previous_state = previousState;
  ctx.state = target as WorkflowContext["state"];
  ctx.transitioned_at = entry.at;
  ctx.transitioned_by = role;

  writeState(ctx);
  return target;
}

// ── Schema Validation ───────────────────────────────────────────────


function isValidWorkflowContext(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;

  // state must be a valid known state
  if (typeof r.state !== "string" || !WORKFLOW_STATES.includes(r.state as never)) {
    return false;
  }

  // artifacts must be an object (Record<string, ArtifactRecord>)
  if (r.artifacts !== undefined) {
    if (typeof r.artifacts !== "object" || r.artifacts === null || Array.isArray(r.artifacts)) {
      return false;
    }
    // Each artifact value must be an object with required fields
    for (const [key, value] of Object.entries(r.artifacts as Record<string, unknown>)) {
      if (typeof key !== "string") return false;
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const a = value as Record<string, unknown>;
      if (typeof a.path !== "string") return false;
      if (typeof a.hash !== "string") return false;
      // sealed_at and sealed_by are optional on load (will be validated at use time)
    }
  }

  // findings_open must be an array
  if (r.findings_open !== undefined && !Array.isArray(r.findings_open)) {
    return false;
  }

  // findings_history must be an array if present
  if (r.findings_history !== undefined && !Array.isArray(r.findings_history)) {
    return false;
  }

  // state_history must be an array if present (v3+)
  if (r.state_history !== undefined && !Array.isArray(r.state_history)) {
    return false;
  }

  // design_findings_open must be an array if present (v4+)
  if (r.design_findings_open !== undefined && !Array.isArray(r.design_findings_open)) {
    return false;
  }

  // design_findings_history must be an array if present (v4+)
  if (r.design_findings_history !== undefined && !Array.isArray(r.design_findings_history)) {
    return false;
  }

  // council_sign_off: null, boolean (v1), or ApprovalRecord (v2)
  if (r.council_sign_off !== undefined && r.council_sign_off !== null) {
    if (typeof r.council_sign_off === "boolean") { /* v1 — valid */ }
    else if (typeof r.council_sign_off === "object" && !Array.isArray(r.council_sign_off)) {
      const a = r.council_sign_off as Record<string, unknown>;
      if (typeof a.approved !== "boolean") return false;
    } else return false;
  }

  // operator_approval: null, boolean (v1), or ApprovalRecord (v2)
  if (r.operator_approval !== undefined && r.operator_approval !== null) {
    if (typeof r.operator_approval === "boolean") { /* v1 — valid */ }
    else if (typeof r.operator_approval === "object" && !Array.isArray(r.operator_approval)) {
      const a = r.operator_approval as Record<string, unknown>;
      if (typeof a.approved !== "boolean") return false;
    } else return false;
  }

  return true;
}

// ── Schema Migration Helpers ─────────────────────────────────────────

/** Convert v1 bare boolean approval to v2 ApprovalRecord. */
function migrateApproval(raw: unknown): ApprovalRecord | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") {
    return {
      approved: raw,
      approved_by: "Operator" as ApprovalRecord["approved_by"],
      approved_at: "unknown",
      method: "state-edit",
    };
  }
  // Already an object — validate shape
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const a = raw as Record<string, unknown>;
    if (typeof a.approved === "boolean") {
      return {
        approved: a.approved,
        approved_by: (typeof a.approved_by === "string" ? a.approved_by : "Operator") as ApprovalRecord["approved_by"],
        approved_at: typeof a.approved_at === "string" ? a.approved_at : "unknown",
        method: typeof a.method === "string" ? (a.method as ApprovalRecord["method"]) : "state-edit",
      };
    }
  }
  return null;
}

// ── Corruption Recovery ─────────────────────────────────────────────

function backupCorruptedState(raw: string): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(dir, `state.json.corrupted.${timestamp}`);
  try {
    writeFileSync(backupPath, raw, "utf-8");
  } catch {
    // Best effort — don't compound the failure
  }
}

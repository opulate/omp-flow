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
import type { WorkflowContext } from "../state-machine/types.js";
import { createInitialContext, WORKFLOW_STATES, type ApprovalRecord } from "../state-machine/types.js";

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

  // Schema migration: v1 → v2 (ApprovalRecord replaces bare booleans)
  const version = typeof p.schema_version === "number" ? p.schema_version : 1;

  let council_sign_off = (p.council_sign_off as WorkflowContext["council_sign_off"]) ?? null;
  let operator_approval = (p.operator_approval as WorkflowContext["operator_approval"]) ?? null;

  if (version < 2) {
    // Migrate bare boolean approvals to ApprovalRecord
    council_sign_off = migrateApproval(p.council_sign_off);
    operator_approval = migrateApproval(p.operator_approval);
  }

  const migrated = version < 2;

  const result: WorkflowContext = {
    schema_version: migrated ? 2 : version,
    state: (p.state as WorkflowContext["state"]) ?? "PLANNING",
    previous_state: (p.previous_state as WorkflowContext["previous_state"]) ?? null,
    current_pr: (p.current_pr as WorkflowContext["current_pr"]) ?? null,
    feature_branch: (p.feature_branch as WorkflowContext["feature_branch"]) ?? null,
    artifacts: (p.artifacts as WorkflowContext["artifacts"]) ?? {},
    council_sign_off,
    operator_approval,
    findings_open: (p.findings_open as WorkflowContext["findings_open"]) ?? [],
    findings_history: (p.findings_history as WorkflowContext["findings_history"]) ?? [],
    block_reason: (p.block_reason as WorkflowContext["block_reason"]) ?? null,
    transitioned_at: (p.transitioned_at as WorkflowContext["transitioned_at"]) ?? null,
    transitioned_by: (p.transitioned_by as WorkflowContext["transitioned_by"]) ?? null,
  };

  // Persist migration so the file is always current schema version
  if (migrated) {
    writeState(result);
  }

  return result;
}

/** Persist workflow state. Writes atomically via temp file + rename. */
export function writeState(ctx: WorkflowContext): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(ctx, null, 2);
  // Write to a temp file in the same directory, then atomically rename.
  // Using the same dir avoids cross-filesystem rename failures.
  const tmp = resolve(dir, `.state-tmp-${randomUUID()}.json`);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, STATE_PATH);
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

/**
 * State persistence — read and write .omp/workflow/state.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { WorkflowContext } from "../state-machine/types.js";
import { createInitialContext } from "../state-machine/types.js";

const STATE_PATH = resolve(".omp/workflow/state.json");

/** Load current workflow state. Creates default if file doesn't exist. */
export function loadState(): WorkflowContext {
  if (!existsSync(STATE_PATH)) {
    const initial = createInitialContext();
    writeState(initial);
    return initial;
  }
  const raw = readFileSync(STATE_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw) as WorkflowContext;
    return {
      state: parsed.state ?? "PLANNING",
      previous_state: parsed.previous_state ?? null,
      current_pr: parsed.current_pr ?? null,
      feature_branch: parsed.feature_branch ?? null,
      artifacts: parsed.artifacts ?? {},
      council_sign_off: parsed.council_sign_off ?? null,
      operator_approval: parsed.operator_approval ?? null,
      findings_open: parsed.findings_open ?? [],
      transitioned_at: parsed.transitioned_at ?? null,
      transitioned_by: parsed.transitioned_by ?? null,
    };
  } catch {
    const initial = createInitialContext();
    writeState(initial);
    return initial;
  }
}

/** Persist workflow state. Writes atomically via temp file + rename. */
export function writeState(ctx: WorkflowContext): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(ctx, null, 2);
  const tmp = resolve(tmpdir(), `omp-workflow-state-${randomUUID()}.json`);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, STATE_PATH);
}

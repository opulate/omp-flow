/**
 * workflow_status — Read current workflow state.
 *
 * Returns structured JSON with current state, artifact summaries,
 * open findings count, and approval status.
 */
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { loadState } from "../../../src/integrity/state-persistence.js";

const factory: CustomToolFactory = (pi) => ({
  name: "workflow_status",
  label: "Workflow Status",
  description: "Read the current workflow state including artifacts, findings, and approvals.",
  parameters: pi.zod.object({}),

  async execute(_toolCallId, _params) {
    const ctx = loadState();

    const artifactSummary: Record<string, { path: string; sealed_at: string; sealed_by: string }> = {};
    for (const [key, artifact] of Object.entries(ctx.artifacts)) {
      artifactSummary[key] = {
        path: artifact.path,
        sealed_at: artifact.sealed_at,
        sealed_by: artifact.sealed_by,
      };
    }

    const p0p1Count = ctx.findings_open.filter(
      (f) => f.severity === "P0" || f.severity === "P1"
    ).length;

    const text = [
      `State: ${ctx.state}`,
      ctx.previous_state ? `Previous: ${ctx.previous_state}` : null,
      ctx.feature_branch ? `Branch: ${ctx.feature_branch}` : null,
      ctx.current_pr ? `PR: ${ctx.current_pr}` : null,
      `Artifacts sealed: ${Object.keys(ctx.artifacts).length}`,
      `Open findings: ${ctx.findings_open.length} (${p0p1Count} P0/P1)`,
      `Council sign-off: ${ctx.council_sign_off ?? "pending"}`,
      `Operator approval: ${ctx.operator_approval ?? "pending"}`,
      ctx.transitioned_at ? `Last transition: ${ctx.transitioned_at}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text", text }],
      details: {
        state: ctx.state,
        previous_state: ctx.previous_state,
        feature_branch: ctx.feature_branch,
        current_pr: ctx.current_pr,
        artifacts: artifactSummary,
        findings_open_count: ctx.findings_open.length,
        p0p1_count: p0p1Count,
        council_sign_off: ctx.council_sign_off,
        operator_approval: ctx.operator_approval,
        transitioned_at: ctx.transitioned_at,
        transitioned_by: ctx.transitioned_by,
      },
    };
  },
});

export default factory;

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

    // Build findings summary
    const findingsLines: string[] = [];
    if (ctx.findings_open.length > 0) {
      findingsLines.push(`Open findings: ${ctx.findings_open.length} (${p0p1Count} P0/P1)`);
      for (const f of ctx.findings_open) {
        findingsLines.push(`  [${f.severity}] ${f.description}`);
      }
    }

    // Format approval status for text display
    const formatApproval = (a: typeof ctx.council_sign_off): string => {
      if (!a) return "pending";
      if (!a.approved) return `denied by ${a.approved_by} at ${a.approved_at}`;
      return `approved by ${a.approved_by} at ${a.approved_at} (${a.method})`;
    };

    // First-run guidance when PLANNING with no artifacts
    const nextAction = (ctx.state === "PLANNING" && Object.keys(ctx.artifacts).length === 0)
      ? "Write a design doc and seal it with artifact_seal(key=\"design-doc\"), then run Planner-Council review. See .omp/agents/planner.md."
      : null;

    // Build state history summary
    const historyLines: string[] = [];
    if ((ctx.state_history ?? []).length > 0) {
      const last3 = (ctx.state_history ?? []).slice(-3);
      historyLines.push(`State history (last ${last3.length} of ${ctx.state_history!.length}):`);
      for (const t of last3) {
        const reasonSuffix = t.reason ? ` (${t.reason})` : "";
        historyLines.push(`  ${t.from} → ${t.to} by ${t.by} at ${t.at}${reasonSuffix}`);
      }
    }

    const text = [
      `State: ${ctx.state}`,
      ctx.previous_state ? `Previous: ${ctx.previous_state}` : null,
      ctx.feature_branch ? `Branch: ${ctx.feature_branch}` : null,
      ctx.current_pr ? `PR: ${ctx.current_pr}` : null,
      ctx.block_reason ? `Block reason: ${ctx.block_reason}` : null,
      `Artifacts sealed: ${Object.keys(ctx.artifacts).length}`,
      `Council sign-off: ${formatApproval(ctx.council_sign_off)}`,
      `Operator approval: ${formatApproval(ctx.operator_approval)}`,
      ...findingsLines,
      ...historyLines,
      nextAction ? `Next: ${nextAction}` : null,
      ctx.transitioned_at ? `Last transition: ${ctx.transitioned_at}` : null,
    ]

    return {
      content: [{ type: "text", text }],
      details: {
        state: ctx.state,
        previous_state: ctx.previous_state,
        state_history: ctx.state_history ?? [],
        feature_branch: ctx.feature_branch,
        current_pr: ctx.current_pr,
        artifacts: artifactSummary,
        findings_open: ctx.findings_open,
        block_reason: ctx.block_reason,
        council_sign_off: ctx.council_sign_off,
        operator_approval: ctx.operator_approval,
        next_action: nextAction,
        transitioned_at: ctx.transitioned_at,
        transitioned_by: ctx.transitioned_by,
      },
    };
  },
});

export default factory;

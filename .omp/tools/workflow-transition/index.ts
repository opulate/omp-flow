/**
 * workflow_transition — Evaluate guard conditions and transition workflow state.
 *
 * Phase 3: Single code path via actor.send(). Guards live exclusively in
 * the XState machine — no duplicate GUARD_MAP. State persistence uses
 * the transitionState() helper which appends to state_history.
 *
 * Actions:
 *   - target + role: attempt transition to target state
 *   - action="approve": operator approval from AWAITING_OPERATOR_APPROVAL or AWAITING_MERGE
 *   - action="reset": operator reset from BLOCKED or DONE
 *   - action="council_signoff": record Council sign-off from PLANNING
 */
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { createActor } from "xstate";
import { loadState, writeState, transitionState } from "../../../src/integrity/state-persistence.js";
import { createWorkflowMachine } from "../../../src/state-machine/machine.js";
import type {
  WorkflowState,
  TransitionTarget,
  Role,
  WorkflowContext,
} from "../../../src/state-machine/types.js";
// ── Helpers ──────────────────────────────────────────────────────────

/** Create a running actor from current persisted state. */
function createRunningActor(ctx: WorkflowContext) {
  const machine = createWorkflowMachine(ctx);
  const actor = createActor(machine);
  actor.start();
  return actor;
}

/** Detect which transition target the machine uses for approve from the current state. */
function approveTarget(state: WorkflowState): TransitionTarget | null {
  if (state === "AWAITING_OPERATOR_APPROVAL") return "IMPLEMENTING";
  if (state === "AWAITING_MERGE") return "DONE";
  return null;
}

// ── Tool Factory ─────────────────────────────────────────────────────

const factory: CustomToolFactory = (pi) => ({
  name: "workflow_transition",
  label: "Transition Workflow",
  description:
    "Attempt a workflow state transition. Validates guard conditions before allowing the transition.",
  parameters: pi.zod.object({
    target: pi.zod
      .enum([
        "AWAITING_OPERATOR_APPROVAL",
        "IMPLEMENTING",
        "AWAITING_COUNCIL_REVIEW",
        "VALIDATING",
        "RETRO",
        "AWAITING_MERGE",
        "DONE",
        "BLOCKED",
      ] as const)
      .optional()
      .describe("Target state to transition to (omit for approve/reset/council_signoff actions)"),
    role: pi.zod
      .enum(["Planner", "Implementor", "Council", "Validator", "Retro", "Operator"] as const)
      .describe("Role initiating the transition"),
    action: pi.zod
      .enum(["approve", "reset", "council_signoff"] as const)
      .optional()
      .describe("Operator/Planner action: 'approve', 'reset', or 'council_signoff'"),
  }),

  async execute(_toolCallId, params) {
    const ctx = loadState();
    const currentState = ctx.state;

    // ── Operator Actions ─────────────────────────────────────────

    // /workflow approve
    if (params.action === "approve") {
      if (params.role !== "Operator") {
        return {
          content: [{ type: "text", text: "Only the Operator can approve. Agents cannot self-approve." }],
          details: { success: false, from: currentState, to: null, error: "Role must be Operator for approve action." },
        };
      }

      const target = approveTarget(currentState);
      if (!target) {
        return {
          content: [{ type: "text", text: `Cannot approve from ${currentState}. Approval is only valid from AWAITING_OPERATOR_APPROVAL or AWAITING_MERGE.` }],
          details: { success: false, from: currentState, to: null, error: `Approve action invalid from ${currentState}` },
        };
      }

      // Record operator approval
      ctx.operator_approval = {
        approved: true,
        approved_by: "Operator",
        approved_at: new Date().toISOString(),
        method: "slash-command",
      };

      // Send approve + transition through the machine
      const actor = createRunningActor(ctx);
      actor.send({ type: "SET_OPERATOR_APPROVAL", value: ctx.operator_approval });
      actor.send({ type: "TRANSITION", target, role: params.role });
      const snapshot = actor.getSnapshot();

      if (snapshot.value !== target) {
        return {
          content: [{ type: "text", text: `Approval blocked: transition ${currentState} → ${target} failed guard. Check contract and artifacts.` }],
          details: { success: false, from: currentState, to: null, error: `Guard blocked ${currentState} → ${target}` },
        };
      }

      // Persist via transitionState (handles state_history)
      const newCtx = snapshot.context as WorkflowContext;
      // transfer operator_approval since machine assign may not have set it
      newCtx.operator_approval = ctx.operator_approval;
      writeState(newCtx);

      return {
        content: [{ type: "text", text: `Approved: ${currentState} → ${target}\nApproved by: Operator\nAt: ${ctx.operator_approval.approved_at}` }],
        details: { success: true, from: currentState, to: target },
      };
    }

    // /workflow reset
    if (params.action === "reset") {
      if (params.role !== "Operator") {
        return {
          content: [{ type: "text", text: "Only the Operator can reset the workflow." }],
          details: { success: false, from: currentState, to: null, error: "Role must be Operator for reset action." },
        };
      }

      // Phase 3: reset from BLOCKED or DONE
      if (currentState !== "BLOCKED" && currentState !== "DONE") {
        return {
          content: [{ type: "text", text: `Cannot reset from ${currentState}. Reset is only valid from BLOCKED or DONE.` }],
          details: { success: false, from: currentState, to: null, error: `Reset action invalid from ${currentState}` },
        };
      }

      if (currentState === "BLOCKED" && !ctx.previous_state) {
        return {
          content: [{ type: "text", text: "Cannot reset: no previous_state recorded. The workflow may need manual intervention." }],
          details: { success: false, from: currentState, to: null, error: "No previous_state for BLOCKED reset." },
        };
      }

      const actor = createRunningActor(ctx);
      actor.send({ type: "RESET", role: params.role });
      const snapshot = actor.getSnapshot();

      const newState = snapshot.value as WorkflowState;
      if (newState === currentState) {
        return {
          content: [{ type: "text", text: `Reset blocked: guard prevented transition from ${currentState}.` }],
          details: { success: false, from: currentState, to: null, error: `Reset guard blocked in ${currentState}` },
        };
      }

      const newCtx = snapshot.context as WorkflowContext;
      writeState(newCtx);
      const resetTarget = currentState === "BLOCKED" ? "(previous state)" : "PLANNING";
      return {
        content: [{ type: "text", text: `Reset: ${currentState} → ${newState} ${resetTarget}\nReset by: Operator\nAt: ${new Date().toISOString()}` }],
        details: { success: true, from: currentState, to: newState },
      };
    }

    // /workflow council_signoff
    if (params.action === "council_signoff") {
      if (params.role !== "Planner") {
        return {
          content: [{ type: "text", text: "Only the Planner can record Council sign-off." }],
          details: { success: false, from: currentState, to: null, error: "Role must be Planner for council_signoff action." },
        };
      }

      if (currentState !== "PLANNING") {
        return {
          content: [{ type: "text", text: `Council sign-off is only valid in PLANNING state. Current state: ${currentState}.` }],
          details: { success: false, from: currentState, to: null, error: `council_signoff invalid from ${currentState}` },
        };
      }

      const approval = {
        approved: true,
        approved_by: "Council" as const,
        approved_at: new Date().toISOString(),
        method: "tool-call" as const,
      };

      ctx.council_sign_off = approval;
      const actor = createRunningActor(ctx);
      actor.send({ type: "SET_COUNCIL_SIGN_OFF", value: approval });
      const snapshot = actor.getSnapshot();
      const newCtx = snapshot.context as WorkflowContext;
      newCtx.council_sign_off = approval;
      writeState(newCtx);

      return {
        content: [{ type: "text", text: `Council sign-off recorded.\nApproved by: Council\nAt: ${approval.approved_at}` }],
        details: { success: true, from: currentState, to: currentState, council_sign_off: approval },
      };
    }

    // ── Regular Transition ───────────────────────────────────────

    if (!params.target) {
      return {
        content: [{ type: "text", text: "Target state is required for transitions. Use 'action: approve', 'action: reset', or 'action: council_signoff' for operator/planner actions." }],
        details: { success: false, from: currentState, to: null, error: "Missing target parameter." },
      };
    }

    const target = params.target as TransitionTarget;

    const actor = createRunningActor(ctx);
    actor.send({ type: "TRANSITION", target, role: params.role });
    const snapshot = actor.getSnapshot();
    const newState = snapshot.value as WorkflowState;

    if (newState === currentState) {
      // Transition blocked by guard
      return {
        content: [{ type: "text", text: `Transition blocked: ${currentState} → ${target}\nReason: Guard prevented transition. Check workflow_status for details on required artifacts and approvals.` }],
        details: { success: false, from: currentState, to: null, error: `Guard blocked ${currentState} → ${target}` },
      };
    }

    // Persist — transitionState handles state_history
    const newCtx = snapshot.context as WorkflowContext;
    writeState(newCtx);

    return {
      content: [{ type: "text", text: `State transitioned: ${currentState} → ${newState}\nTransitioned by: ${params.role}\nAt: ${new Date().toISOString()}` }],
      details: { success: true, from: currentState, to: newState },
    };
  },
});

export default factory;

/**
 * workflow_transition — Evaluate guard conditions and transition workflow state.
 *
 * This is the core enforcement mechanism. On a TRANSITION event:
 * 1. Load current state from .omp/workflow/state.json
 * 2. Create/advance XState machine to current state
 * 3. Evaluate the guard for the requested transition
 * 4. On pass: write new state, return success
 * 5. On fail: return structured error with reason
 */
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { createActor } from "xstate";
import { loadState, writeState } from "../../../src/integrity/state-persistence.js";
import { createWorkflowMachine } from "../../../src/state-machine/machine.js";
import type {
  WorkflowState,
  TransitionTarget,
  Role,
} from "../../../src/state-machine/types.js";
import {
  guardPlanningToAwaitingApproval,
  guardAwaitingApprovalToImplementing,
  guardImplementingToAwaitingCouncil,
  guardAwaitingCouncilToValidating,
  guardValidatingToRetro,
  guardRetroToAwaitingMerge,
  guardAwaitingMergeToDone,
  guardBlockedToPrevious,
} from "../../../src/state-machine/guards.js";
import type { GuardResult } from "../../../src/state-machine/types.js";

/** Map transition target to the guard function that validates the edge. */
const GUARD_MAP: Record<string, (ctx: ReturnType<typeof loadState>) => GuardResult> = {
  AWAITING_OPERATOR_APPROVAL: guardPlanningToAwaitingApproval,
  IMPLEMENTING: (ctx) => {
    // TWO possible sources: AWAITING_OPERATOR_APPROVAL → IMPLEMENTING
    // or AWAITING_COUNCIL_REVIEW → IMPLEMENTING (Council returns findings)
    if (ctx.state === "AWAITING_OPERATOR_APPROVAL") {
      return guardAwaitingApprovalToImplementing(ctx);
    }
    if (ctx.state === "AWAITING_COUNCIL_REVIEW") {
      // Council returns findings — always allowed
      return { allowed: true };
    }
    if (ctx.state === "VALIDATING") {
      // Validator found regressions — always allowed
      return { allowed: true };
    }
    return { allowed: false, reason: `Cannot transition to IMPLEMENTING from ${ctx.state}` };
  },
  AWAITING_COUNCIL_REVIEW: guardImplementingToAwaitingCouncil,
  VALIDATING: guardAwaitingCouncilToValidating,
  RETRO: guardValidatingToRetro,
  AWAITING_MERGE: guardRetroToAwaitingMerge,
  DONE: guardAwaitingMergeToDone,
};

/** Valid transitions from each state */
const VALID_TARGETS: Record<WorkflowState, TransitionTarget[]> = {
  PLANNING: ["AWAITING_OPERATOR_APPROVAL", "BLOCKED"],
  AWAITING_OPERATOR_APPROVAL: ["IMPLEMENTING", "BLOCKED"],
  IMPLEMENTING: ["AWAITING_COUNCIL_REVIEW", "BLOCKED"],
  AWAITING_COUNCIL_REVIEW: ["VALIDATING", "IMPLEMENTING", "BLOCKED"],
  VALIDATING: ["RETRO", "IMPLEMENTING", "BLOCKED"],
  RETRO: ["AWAITING_MERGE", "BLOCKED"],
  AWAITING_MERGE: ["DONE", "BLOCKED"],
  DONE: [],
  ERROR: [],
  BLOCKED: [], // Reset handled separately
};

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
      .describe("Target state to transition to (omit for approve/reset actions)"),
    role: pi.zod
      .enum(["Planner", "Implementor", "Council", "Validator", "Retro", "Operator"] as const)
      .describe("Role initiating the transition"),
    action: pi.zod
      .enum(["approve", "reset"] as const)
      .optional()
      .describe("Operator action: 'approve' to approve and advance, 'reset' to reset from BLOCKED"),
  }),


  async execute(_toolCallId, params) {
    const ctx = loadState();
    const currentState = ctx.state;

    // ── Operator Actions ─────────────────────────────────────────

    // /workflow approve: record operator approval and advance
    if (params.action === "approve") {
      if (params.role !== "Operator") {
        return {
          content: [{ type: "text", text: "Only the Operator can approve. Agents cannot self-approve." }],
          details: { success: false, from: currentState, to: null, error: "Role must be Operator for approve action." },
        };
      }
      if (currentState === "AWAITING_OPERATOR_APPROVAL") {
        ctx.operator_approval = {
          approved: true,
          approved_by: "Operator",
          approved_at: new Date().toISOString(),
          method: "slash-command",
        };
        // Evaluate the guard — structured contract validation happens here
        const guardResult = guardAwaitingApprovalToImplementing(ctx);
        if (!guardResult.allowed) {
          return {
            content: [{ type: "text", text: `Approval blocked: ${guardResult.reason}` }],
            details: { success: false, from: currentState, to: null, error: guardResult.reason },
          };
        }
        ctx.previous_state = currentState;
        ctx.state = "IMPLEMENTING";
        ctx.transitioned_at = ctx.operator_approval.approved_at;
        ctx.transitioned_by = "Operator";
        writeState(ctx);
        return {
          content: [{ type: "text", text: `Approved: ${currentState} → IMPLEMENTING\nApproved by: Operator\nAt: ${ctx.transitioned_at}` }],
          details: { success: true, from: currentState, to: "IMPLEMENTING" },
        };
      }
      if (currentState === "AWAITING_MERGE") {
        ctx.operator_approval = {
          approved: true,
          approved_by: "Operator",
          approved_at: new Date().toISOString(),
          method: "slash-command",
        };
        ctx.previous_state = currentState;
        ctx.state = "DONE";
        ctx.transitioned_at = ctx.operator_approval.approved_at;
        ctx.transitioned_by = "Operator";
        writeState(ctx);
        return {
          content: [{ type: "text", text: `Approved: ${currentState} → DONE\nApproved by: Operator\nAt: ${ctx.transitioned_at}` }],
          details: { success: true, from: currentState, to: "DONE" },
        };
      }
      return {
        content: [{ type: "text", text: `Cannot approve from ${currentState}. Approval is only valid from AWAITING_OPERATOR_APPROVAL or AWAITING_MERGE.` }],
        details: { success: false, from: currentState, to: null, error: `Approve action invalid from ${currentState}` },
      };
    }

    // /workflow reset: reset from BLOCKED
    if (params.action === "reset") {
      if (params.role !== "Operator") {
        return {
          content: [{ type: "text", text: "Only the Operator can reset the workflow." }],
          details: { success: false, from: currentState, to: null, error: "Role must be Operator for reset action." },
        };
      }
      if (currentState === "BLOCKED") {
        const guardResult = guardBlockedToPrevious(ctx);
        if (!guardResult.allowed) {
          return {
            content: [{ type: "text", text: `Reset blocked: ${guardResult.reason}` }],
            details: { success: false, from: currentState, to: null, error: guardResult.reason },
          };
        }
        const resetTarget = ctx.previous_state ?? "PLANNING";
        ctx.previous_state = "BLOCKED";
        ctx.state = resetTarget;
        ctx.block_reason = null;
        ctx.transitioned_at = new Date().toISOString();
        ctx.transitioned_by = "Operator";
        writeState(ctx);
        return {
          content: [{ type: "text", text: `Reset: BLOCKED → ${resetTarget}\nReset by: Operator\nAt: ${ctx.transitioned_at}` }],
          details: { success: true, from: "BLOCKED", to: resetTarget },
        };
      }
      return {
        content: [{ type: "text", text: `Cannot reset from ${currentState}. Reset is only valid from BLOCKED.` }],
        details: { success: false, from: currentState, to: null, error: `Reset action invalid from ${currentState}` },
      };
    }

    // Target is required for regular transitions (not approve/reset)
    if (!params.target) {
      return {
        content: [{ type: "text", text: "Target state is required for transitions. Use 'action: approve' or 'action: reset' for operator actions." }],
        details: { success: false, from: currentState, to: null, error: "Missing target parameter." },
      };
    }


    const target = params.target as TransitionTarget;

    // ── BLOCKED: allow reset to previous state ───────────────────
    if (currentState === "BLOCKED") {
      const guardResult = guardBlockedToPrevious(ctx);
      if (!guardResult.allowed) {
        return {
          content: [{ type: "text", text: `Reset blocked: ${guardResult.reason}` }],
          details: { success: false, from: currentState, to: null, error: guardResult.reason },
        };
      }
      const resetTarget = ctx.previous_state ?? "PLANNING";
      if (target !== resetTarget) {
        return {
          content: [{ type: "text", text: `Cannot transition from BLOCKED to ${target}. Reset target must be ${resetTarget} (previous state).` }],
          details: { success: false, from: currentState, to: null, error: `From BLOCKED, only reset to ${resetTarget} is allowed.` },
        };
      }
      ctx.previous_state = "BLOCKED";
      ctx.state = resetTarget;
      ctx.transitioned_at = new Date().toISOString();
      ctx.transitioned_by = params.role as Role;
      writeState(ctx);
      return {
        content: [{ type: "text", text: `State reset: BLOCKED → ${resetTarget}\nReset by: ${params.role}\nAt: ${ctx.transitioned_at}` }],
        details: { success: true, from: "BLOCKED", to: resetTarget },
      };
    }

    // Validate the transition is structurally valid
    const validTargets = VALID_TARGETS[currentState] ?? [];
    if (!validTargets.includes(target)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid transition: ${currentState} → ${target}\nValid targets from ${currentState}: ${validTargets.join(", ") || "none"}`,
          },
        ],
        details: {
          success: false,
          from: currentState,
          to: null,
          error: `Invalid transition from ${currentState} to ${target}`,
        },
      };
    }

    // BLOCKED target goes straight through (no guard to evaluate for BLOCKED)
    if (target === "BLOCKED") {
      ctx.previous_state = currentState;
      ctx.state = "BLOCKED";
      ctx.transitioned_at = new Date().toISOString();
      ctx.transitioned_by = params.role as Role;
      writeState(ctx);

      return {
        content: [{ type: "text", text: `State transitioned: ${currentState} → BLOCKED` }],
        details: { success: true, from: currentState, to: "BLOCKED" },
      };
    }

    // Evaluate guard
    const guardFn = GUARD_MAP[target];
    if (!guardFn) {
      return {
        content: [
          {
            type: "text",
            text: `No guard defined for transition to ${target}`,
          },
        ],
        details: {
          success: false,
          from: currentState,
          to: null,
          error: `No guard defined for target: ${target}`,
        },
      };
    }

    const guardResult = guardFn(ctx);
    if (!guardResult.allowed) {
      return {
        content: [
          {
            type: "text",
            text: `Transition blocked: ${currentState} → ${target}\nReason: ${guardResult.reason}`,
          },
        ],
        details: {
          success: false,
          from: currentState,
          to: null,
          error: guardResult.reason,
        },
      };
    }

    // Transition passes — advance state via XState machine, then persist
    const previousState = currentState;
    ctx.state = target;
    ctx.previous_state = previousState;
    ctx.transitioned_at = new Date().toISOString();
    ctx.transitioned_by = params.role as Role;

    // Advance the machine to keep context in sync (uses createActor to avoid crash)
    const machine = createWorkflowMachine(ctx);
    const actor = createActor(machine);
    const snapshot = actor.getSnapshot();
    const nextSnapshot = machine.transition(snapshot, {
      type: "TRANSITION",
      target,
      role: params.role as Role,
    });
    if (nextSnapshot.context) {
      Object.assign(ctx, nextSnapshot.context);
    }

    // Single atomic write
    writeState(ctx);

    const text = `State transitioned: ${previousState} → ${target}\nTransitioned by: ${params.role}\nAt: ${ctx.transitioned_at}`;

    return {
      content: [{ type: "text", text }],
      details: {
        success: true,
        from: previousState,
        to: target,
      },
    };
  },
});

export default factory;

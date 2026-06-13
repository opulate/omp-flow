/**
 * XState v5 statechart for the omp-flow workflow.
 *
 * Phase 3: state_history tracking on every transition. DONE is resettable.
 * Guards are injected so the machine definition stays pure.
 */
import { setup, assign } from "xstate";
import type { WorkflowContext, TransitionTarget, Role, ApprovalRecord, WorkflowState } from "./types.js";
import {
  guardPlanningToAwaitingDesignReview,
  guardAwaitingDesignReviewToAwaitingApproval,
  guardAwaitingDesignReviewToPlanning,
  guardAwaitingApprovalToImplementing,
  guardImplementingToAwaitingCouncil,
  guardAwaitingCouncilToValidating,
  guardAwaitingCouncilToImplementing,
  guardValidatingToRetro,
  guardValidatingToImplementing,
  guardRetroToAwaitingMerge,
  guardAwaitingMergeToDone,
  guardToBlocked,
  guardBlockedToPrevious,
} from "./guards.js";

// ── Events ──────────────────────────────────────────────────────────

export type WorkflowEvent =
  | { type: "TRANSITION"; target: TransitionTarget; role: Role }
  | { type: "BLOCK"; reason: string }
  | { type: "SET_BRANCH"; branch: string }
  | { type: "SET_PR"; pr: string }
  | { type: "RESET"; role?: Role }
  | { type: "SET_OPERATOR_APPROVAL"; value: ApprovalRecord }
  | { type: "SET_COUNCIL_SIGN_OFF"; value: ApprovalRecord };

// ── Transition Action Helpers ───────────────────────────────────────
/** Build the assign payload for a TRANSITION event. */
function trans(target: WorkflowState) {
  return {
    state: target,
    previous_state: ({ context }: { context: WorkflowContext }) => context.state,
    state_history: ({ context, event }: { context: WorkflowContext; event: { role?: Role } }) => {
      const history = [...(context.state_history ?? []), {
        from: context.state,
        to: target,
        at: new Date().toISOString(),
        by: event.role ?? ("unknown" as Role),
      }];
      if (history.length > 50) history.splice(0, history.length - 50);
      return history;
    },
    transitioned_at: () => new Date().toISOString(),
    transitioned_by: ({ event }: { event: { role?: Role } }) => event.role ?? ("unknown" as Role),
  };
}

/** Build assign payload for RESET events (clears block_reason). */
function resetTrans(target: WorkflowState) {
  return { ...trans(target), block_reason: null };
}

/** Build the assign payload for a BLOCK event. */
function blk() {
  return {
    state: "BLOCKED" as WorkflowState,
    previous_state: ({ context }: { context: WorkflowContext }) => context.state,
    state_history: ({ context, event }: { context: WorkflowContext; event: { reason: string } }) => {
      const history = [...(context.state_history ?? []), {
        from: context.state,
        to: "BLOCKED" as WorkflowState,
        at: new Date().toISOString(),
        by: "unknown" as Role,
        reason: event.reason,
      }];
      if (history.length > 50) history.splice(0, history.length - 50);
      return history;
    },
    block_reason: ({ event }: { event: { reason: string } }) => event.reason,
  };
}

/** Build the assign payload for DONE → PLANNING RESET. */
function doneReset() {
  return {
    state: "PLANNING" as WorkflowState,
    previous_state: "DONE" as WorkflowState,
    state_history: ({ context }: { context: WorkflowContext }) => {
      const history = [...(context.state_history ?? []), {
        from: "DONE" as WorkflowState,
        to: "PLANNING" as WorkflowState,
        at: new Date().toISOString(),
        by: "Operator" as Role,
      }];
      if (history.length > 50) history.splice(0, history.length - 50);
      return history;
    },
    artifacts: {} as Record<string, never>,
    council_sign_off: null,
    operator_approval: null,
    findings_open: [] as never[],
    findings_history: ({ context }: { context: WorkflowContext }) => [
      ...(context.findings_history ?? []),
      ...(context.findings_open ?? []).map((f) => ({
        ...f,
        status: "closed" as const,
        closed_at: new Date().toISOString(),
      })),
    ],
    block_reason: null,
    transitioned_at: () => new Date().toISOString(),
    transitioned_by: "Operator" as Role,
  };
}

// ── Machine Factory ─────────────────────────────────────────────────

export function createWorkflowMachine(initialContext: WorkflowContext) {
  return setup({
    types: {
      context: {} as WorkflowContext,
      events: {} as WorkflowEvent,
    },
    guards: {
      canTransitionToAwaitingDesignReview: ({ context }) =>
        guardPlanningToAwaitingDesignReview(context).allowed,
      canTransitionFromDesignReviewToAwaitingApproval: ({ context }) =>
        guardAwaitingDesignReviewToAwaitingApproval(context).allowed,
      canTransitionFromDesignReviewToPlanning: ({ context }) =>
        guardAwaitingDesignReviewToPlanning(context).allowed,
      canTransitionToImplementing: ({ context }) =>
        guardAwaitingApprovalToImplementing(context).allowed,
      canTransitionToAwaitingCouncil: ({ context }) =>
        guardImplementingToAwaitingCouncil(context).allowed,
      canTransitionToValidating: ({ context }) =>
        guardAwaitingCouncilToValidating(context).allowed,
      canTransitionFromCouncilToImplementing: ({ context }) =>
        guardAwaitingCouncilToImplementing(context).allowed,
      canTransitionToRetro: ({ context }) =>
        guardValidatingToRetro(context).allowed,
      canTransitionFromValidatingToImplementing: ({ context }) =>
        guardValidatingToImplementing(context).allowed,
      canTransitionToAwaitingMerge: ({ context }) =>
        guardRetroToAwaitingMerge(context).allowed,
      canTransitionToDone: ({ context }) =>
        guardAwaitingMergeToDone(context).allowed,
      canTransitionToBlocked: ({ context }) =>
        guardToBlocked(context).allowed,
      canResetToPrevious: ({ context }) =>
        guardBlockedToPrevious(context).allowed,
    },
  }).createMachine({
    id: "omp-workflow",
    version: "5",
    context: initialContext,
    initial: initialContext.state,

    on: {
      SET_BRANCH: { actions: assign({ feature_branch: ({ event }) => event.branch }) },
      SET_PR: { actions: assign({ current_pr: ({ event }) => event.pr }) },
      SET_OPERATOR_APPROVAL: { actions: assign({ operator_approval: ({ event }) => event.value }) },
      SET_COUNCIL_SIGN_OFF: { actions: assign({ council_sign_off: ({ event }) => event.value }) },
    },

    states: {
      PLANNING: {
        on: {
          TRANSITION: { guard: { type: "canTransitionToAwaitingDesignReview" }, target: "AWAITING_DESIGN_REVIEW", actions: assign(trans("AWAITING_DESIGN_REVIEW")) },
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      "AWAITING_DESIGN_REVIEW": {
        on: {
          TRANSITION: [
            { guard: { type: "canTransitionFromDesignReviewToAwaitingApproval" }, target: "AWAITING_OPERATOR_APPROVAL", actions: assign(trans("AWAITING_OPERATOR_APPROVAL")) },
            { guard: { type: "canTransitionFromDesignReviewToPlanning" }, target: "PLANNING", actions: assign(trans("PLANNING")) },
          ],
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      "AWAITING_OPERATOR_APPROVAL": {
        on: {
          TRANSITION: { guard: { type: "canTransitionToImplementing" }, target: "IMPLEMENTING", actions: assign(trans("IMPLEMENTING")) },
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      IMPLEMENTING: {
        on: {
          TRANSITION: { guard: { type: "canTransitionToAwaitingCouncil" }, target: "AWAITING_COUNCIL_REVIEW", actions: assign(trans("AWAITING_COUNCIL_REVIEW")) },
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      "AWAITING_COUNCIL_REVIEW": {
        on: {
          TRANSITION: [
            { guard: { type: "canTransitionToValidating" }, target: "VALIDATING", actions: assign(trans("VALIDATING")) },
            { guard: { type: "canTransitionFromCouncilToImplementing" }, target: "IMPLEMENTING", actions: assign(trans("IMPLEMENTING")) },
          ],
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      VALIDATING: {
        on: {
          TRANSITION: [
            { guard: { type: "canTransitionToRetro" }, target: "RETRO", actions: assign(trans("RETRO")) },
            { guard: { type: "canTransitionFromValidatingToImplementing" }, target: "IMPLEMENTING", actions: assign(trans("IMPLEMENTING")) },
          ],
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      RETRO: {
        on: {
          TRANSITION: { guard: { type: "canTransitionToAwaitingMerge" }, target: "AWAITING_MERGE", actions: assign(trans("AWAITING_MERGE")) },
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      "AWAITING_MERGE": {
        on: {
          TRANSITION: { guard: { type: "canTransitionToDone" }, target: "DONE", actions: assign(trans("DONE")) },
          BLOCK: { guard: { type: "canTransitionToBlocked" }, target: "BLOCKED", actions: assign(blk()) },
        },
      },
      DONE: {
        on: {
          RESET: { target: "PLANNING", actions: assign(doneReset()) },
        },
      },
      ERROR: {
        on: {
          RESET: { target: "PLANNING", actions: assign(resetTrans("PLANNING")) },
        },
      },
      BLOCKED: {
        on: {
          RESET: { guard: { type: "canResetToPrevious" }, target: "PLANNING", actions: assign(resetTrans("PLANNING")) },
        },
      },
    },
  });
}

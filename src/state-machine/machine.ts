/**
 * XState v5 statechart for the omp-flow workflow.
 *
 * All states and valid transitions as per the specification.
 * Guard functions are injected so the machine definition stays pure
 * and guards can be unit-tested independently.
 */

import { setup, assign } from "xstate";
import type { WorkflowContext, TransitionTarget, Role } from "./types.js";
import {
  guardPlanningToAwaitingApproval,
  guardAwaitingApprovalToImplementing,
  guardImplementingToAwaitingCouncil,
  guardAwaitingCouncilToValidating,
  guardAwaitingCouncilToImplementing,
  guardValidatingToRetro,
  guardValidatingToImplementing,
  guardRetroToAwaitingMerge,
  guardAwaitingMergeToDone,
  guardToBlocked,
} from "./guards.js";

// ── Events ──────────────────────────────────────────────────────────

export type WorkflowEvent =
  | { type: "TRANSITION"; target: TransitionTarget; role: Role }
  | { type: "BLOCK"; reason: string }
  | { type: "RESET" }
  | { type: "SET_BRANCH"; branch: string }
  | { type: "SET_PR"; pr: string }
  | { type: "SET_OPERATOR_APPROVAL"; value: boolean }
  | { type: "SET_COUNCIL_SIGN_OFF"; value: boolean };

// ── Machine Factory ─────────────────────────────────────────────────

export function createWorkflowMachine(initialContext: WorkflowContext) {
  return setup({
    types: {
      context: {} as WorkflowContext,
      events: {} as WorkflowEvent,
    },
    guards: {
      canTransitionToAwaitingApproval: ({ context }) =>
        guardPlanningToAwaitingApproval(context).allowed,
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
    },
  }).createMachine({
    id: "omp-workflow",
    version: "5",
    context: initialContext,
    initial: initialContext.state,

    states: {
      PLANNING: {
        on: {
          TRANSITION: {
            guard: { type: "canTransitionToAwaitingApproval" },
            target: "AWAITING_OPERATOR_APPROVAL",
            actions: assign({
              state: "AWAITING_OPERATOR_APPROVAL",
              previous_state: "PLANNING",
              transitioned_at: () => new Date().toISOString(),
              transitioned_by: ({ event }) => event.role,
            }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "PLANNING",
              state: "BLOCKED",
            }),
          },
          SET_BRANCH: {
            actions: assign({ feature_branch: ({ event }) => event.branch }),
          },
          SET_PR: {
            actions: assign({ current_pr: ({ event }) => event.pr }),
          },
        },
      },

      "AWAITING_OPERATOR_APPROVAL": {
        on: {
          TRANSITION: {
            guard: { type: "canTransitionToImplementing" },
            target: "IMPLEMENTING",
            actions: assign({
              state: "IMPLEMENTING",
              previous_state: "AWAITING_OPERATOR_APPROVAL",
              transitioned_at: () => new Date().toISOString(),
              transitioned_by: ({ event }) => event.role,
            }),
          },
          SET_OPERATOR_APPROVAL: {
            actions: assign({ operator_approval: ({ event }) => event.value }),
          },
          SET_COUNCIL_SIGN_OFF: {
            actions: assign({ council_sign_off: ({ event }) => event.value }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "AWAITING_OPERATOR_APPROVAL",
              state: "BLOCKED",
            }),
          },
        },
      },

      IMPLEMENTING: {
        on: {
          TRANSITION: {
            guard: { type: "canTransitionToAwaitingCouncil" },
            target: "AWAITING_COUNCIL_REVIEW",
            actions: assign({
              state: "AWAITING_COUNCIL_REVIEW",
              previous_state: "IMPLEMENTING",
              transitioned_at: () => new Date().toISOString(),
              transitioned_by: ({ event }) => event.role,
            }),
          },
          SET_BRANCH: {
            actions: assign({ feature_branch: ({ event }) => event.branch }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "IMPLEMENTING",
              state: "BLOCKED",
            }),
          },
        },
      },

      "AWAITING_COUNCIL_REVIEW": {
        on: {
          TRANSITION: [
            {
              guard: { type: "canTransitionToValidating" },
              target: "VALIDATING",
              actions: assign({
                state: "VALIDATING",
                previous_state: "AWAITING_COUNCIL_REVIEW",
                transitioned_at: () => new Date().toISOString(),
                transitioned_by: ({ event }) => event.role,
              }),
            },
            {
              guard: { type: "canTransitionFromCouncilToImplementing" },
              target: "IMPLEMENTING",
              actions: assign({
                state: "IMPLEMENTING",
                previous_state: "AWAITING_COUNCIL_REVIEW",
                transitioned_at: () => new Date().toISOString(),
                transitioned_by: ({ event }) => event.role,
              }),
            },
          ],
          SET_COUNCIL_SIGN_OFF: {
            actions: assign({ council_sign_off: ({ event }) => event.value }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "AWAITING_COUNCIL_REVIEW",
              state: "BLOCKED",
            }),
          },
        },
      },

      VALIDATING: {
        on: {
          TRANSITION: [
            {
              guard: { type: "canTransitionToRetro" },
              target: "RETRO",
              actions: assign({
                state: "RETRO",
                previous_state: "VALIDATING",
                transitioned_at: () => new Date().toISOString(),
                transitioned_by: ({ event }) => event.role,
              }),
            },
            {
              guard: { type: "canTransitionFromValidatingToImplementing" },
              target: "IMPLEMENTING",
              actions: assign({
                state: "IMPLEMENTING",
                previous_state: "VALIDATING",
                transitioned_at: () => new Date().toISOString(),
                transitioned_by: ({ event }) => event.role,
              }),
            },
          ],
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "VALIDATING",
              state: "BLOCKED",
            }),
          },
        },
      },

      RETRO: {
        on: {
          TRANSITION: {
            guard: { type: "canTransitionToAwaitingMerge" },
            target: "AWAITING_MERGE",
            actions: assign({
              state: "AWAITING_MERGE",
              previous_state: "RETRO",
              transitioned_at: () => new Date().toISOString(),
              transitioned_by: ({ event }) => event.role,
            }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "RETRO",
              state: "BLOCKED",
            }),
          },
        },
      },

      "AWAITING_MERGE": {
        on: {
          TRANSITION: {
            guard: { type: "canTransitionToDone" },
            target: "DONE",
            actions: assign({
              state: "DONE",
              previous_state: "AWAITING_MERGE",
              transitioned_at: () => new Date().toISOString(),
              transitioned_by: ({ event }) => event.role,
            }),
          },
          SET_OPERATOR_APPROVAL: {
            actions: assign({ operator_approval: ({ event }) => event.value }),
          },
          BLOCK: {
            target: "BLOCKED",
            actions: assign({
              previous_state: "AWAITING_MERGE",
              state: "BLOCKED",
            }),
          },
        },
      },

      DONE: {
        type: "final",
      },

      ERROR: {
        on: {
          RESET: {
            target: "PLANNING",
            actions: assign({
              state: "PLANNING",
              previous_state: "ERROR",
              transitioned_at: () => new Date().toISOString(),
            }),
          },
        },
      },

      BLOCKED: {
        on: {
          // RESET from BLOCKED always goes to PLANNING in the machine.
          // The workflow_transition tool handles restoring the actual
          // previous_state when the operator issues a reset.
          RESET: {
            target: "PLANNING",
            actions: assign({
              state: "PLANNING",
              previous_state: "BLOCKED",
              transitioned_at: () => new Date().toISOString(),
            }),
          },
        },
      },
    },
  });
}

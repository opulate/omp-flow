/**
 * workflow-gate — Pre-hook that intercepts role-implying tool calls
 * and blocks on invalid workflow state.
 *
 * The gate enforces state-machine discipline at the tool level:
 * - During IMPLEMENTING: blocks writes/merges targeting `main`
 * - During IMPLEMENTING: warns then blocks `write` on existing files (surgical edit discipline)
 * - During AWAITING_COUNCIL_REVIEW: blocks code modifications
 * - During VALIDATING: blocks code modifications
 * - During DONE: blocks further modifications
 */
import type { HookAPI } from "@oh-my-pi/pi-coding-agent";
import { loadState } from "../../../src/integrity/state-persistence.js";
import { existsSync } from "node:fs";

// Tool calls that imply code modification (role-implying actions)

// ── Surgical Edit Session Tracking ────────────────────────────
// Tracks `write` calls on existing files during IMPLEMENTING.
// First occurrence: warning. Second: hard block. Resets on harness restart.
let writeOnExistingFileCount = 0;

const MODIFYING_TOOLS = new Set([
  "write",
  "edit",
  "ast_edit",
]);

// Git commands that target main branch
const MAIN_BRANCH_PATTERNS = [
  /\bgit\s+(merge|push|commit)\b.*\bmain\b/i,
  /\bgit\s+checkout\s+main\b/i,
  /\bgit\s+pull\s+.*\bmain\b/i,
];

export default function (pi: HookAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const state = loadState();

    // ── DONE: block everything ──────────────────────────────────
    if (state.state === "DONE") {
      if (event.toolName === "workflow_status") return undefined; // always allowed
      return {
        block: true,
        reason: `Workflow is DONE. No further actions allowed. Start a new planning cycle.`,
      };
    }

    // ── IMPLEMENTING: block main-branch ops + surgical edit ────
    if (state.state === "IMPLEMENTING") {
      if (event.toolName === "bash") {
        const command = (event.input as { command?: string }).command ?? "";
        const isMainOp = MAIN_BRANCH_PATTERNS.some((p) => p.test(command));
        if (isMainOp) {
          return {
            block: true,
            reason: `Cannot operate on 'main' during IMPLEMENTING. Feature branch is: ${state.feature_branch ?? "unknown"}. Use a feature branch.`,
          };
        }
      }

      // Surgical edit discipline: warn then block `write` on existing files
      if (event.toolName === "write") {
        const filePath = (event.input as { path?: string }).path;
        if (filePath && existsSync(filePath)) {
          writeOnExistingFileCount++;
          if (writeOnExistingFileCount === 1) {
            return {
              block: false,
              reason: `Surgical edit recommended. Use 'edit' with hashline anchors for existing files. 'write' replaces the entire file. This is a warning — repeated use will be blocked.`,
            };
          }
          return {
            block: true,
            reason: `Surgical edit required. Use 'edit' with hashline anchors for existing files. 'write' replaces the entire file.`,
          };
        }
      }
    }

    // ── AWAITING_COUNCIL_REVIEW: block code changes ─────────────
    if (state.state === "AWAITING_COUNCIL_REVIEW") {
      const reviewBlockedTools = new Set(["write", "edit", "ast_edit", "bash"]);
      if (reviewBlockedTools.has(event.toolName)) {
        return {
          block: true,
          reason: `Cannot modify code during AWAITING_COUNCIL_REVIEW. Address Council findings or transition back to IMPLEMENTING first.`,
        };
      }
    }

    // ── VALIDATING: block code changes ──────────────────────────
    if (state.state === "VALIDATING") {
      if (MODIFYING_TOOLS.has(event.toolName)) {
        return {
          block: true,
          reason: `Cannot modify code during VALIDATING. Fix regressions by transitioning back to IMPLEMENTING first.`,
        };
      }
    }

    // ── BLOCKED: block everything except status and reset ───────
    if (state.state === "BLOCKED") {
      const allowed = new Set(["workflow_status", "workflow_transition"]);
      if (!allowed.has(event.toolName)) {
        return {
          block: true,
          reason: `Workflow is BLOCKED. Use workflow_transition to reset or /workflow status to inspect.`,
        };
      }
    }

    return undefined; // allow
  });
}

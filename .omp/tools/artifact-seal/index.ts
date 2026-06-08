/**
 * artifact_seal — Compute SHA-256 hash of a file and record it in workflow state.
 *
 * On seal:
 * - Computes SHA-256 of file at `path`
 * - Records hash with `key` in `.omp/workflow/state.json`
 * - Returns the seal result
 */
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { computeHash } from "../../../src/integrity/hash.js";
import { loadState, writeState } from "../../../src/integrity/state-persistence.js";
import type { Role } from "../../../src/state-machine/types.js";

const factory: CustomToolFactory = (pi) => ({
  name: "artifact_seal",
  label: "Seal Artifact",
  description:
    "Compute SHA-256 hash of a file and record it in workflow state. Sealed artifacts are verified on transition.",
  parameters: pi.zod.object({
    key: pi.zod
      .string()
      .describe(
        "Artifact key (e.g. 'design-doc', 'impl-complete', 'validation-contract', 'council-report', 'validation-report', 'retro-doc')"
      ),
    path: pi.zod.string().describe("Path to the file to seal"),
    role: pi.zod
      .enum(["Planner", "Implementor", "Council", "Validator", "Retro", "Operator"] as const)
      .describe("Role performing the seal"),
  }),

  async execute(_toolCallId, params) {
    const hash = computeHash(params.path);
    if (hash === null) {
      return {
        content: [{ type: "text", text: `Error: File not found at path: ${params.path}` }],
        details: { error: "file_not_found", path: params.path },
      };
    }

    const ctx = loadState();
    const sealedAt = new Date().toISOString();
    ctx.artifacts[params.key] = {
      path: params.path,
      hash,
      sealed_at: sealedAt,
      sealed_by: params.role as Role,
    };
    writeState(ctx);

    const text = [
      `Artifact sealed: ${params.key}`,
      `Path: ${params.path}`,
      `SHA-256: ${hash}`,
      `Sealed at: ${sealedAt}`,
      `Sealed by: ${params.role}`,
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      details: {
        key: params.key,
        path: params.path,
        hash,
        sealed_at: sealedAt,
        sealed_by: params.role,
      },
    };
  },
});

export default factory;

/**
 * artifact_verify — Recompute SHA-256 hash and compare against stored record.
 *
 * Returns pass/fail. A modified artifact fails the gate on transition.
 */
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { computeHash } from "../../../src/integrity/hash.js";
import { loadState } from "../../../src/integrity/state-persistence.js";

const factory: CustomToolFactory = (pi) => ({
  name: "artifact_verify",
  label: "Verify Artifact",
  description:
    "Recompute SHA-256 hash of a file and compare against the stored record. Returns pass/fail.",
  parameters: pi.zod.object({
    key: pi.zod
      .string()
      .describe(
        "Artifact key to verify (e.g. 'design-doc', 'impl-complete', 'validation-contract')"
      ),
    path: pi.zod.string().describe("Path to the file to verify (used if key not found)"),
  }),

  async execute(_toolCallId, params) {
    const ctx = loadState();
    const stored = ctx.artifacts[params.key] ?? null;
    // Use stored path when key exists, fall back to caller-provided path
    const verifyPath = stored?.path ?? params.path;
    const storedHash = stored?.hash ?? null;
    const computedHash = computeHash(verifyPath);

    if (computedHash === null) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File not found at path: ${params.path}`,
          },
        ],
        details: { error: "file_not_found", key: params.key, path: params.path },
      };
    }

    const match = computedHash === storedHash;

    let text: string;
    if (!stored) {
      text = `No stored artifact found for key: ${params.key}\nComputed hash: ${computedHash}`;
    } else if (match) {
      text = [
        `✓ Artifact verified: ${params.key}`,
        `Hash matches: ${computedHash}`,
        `Sealed at: ${stored.sealed_at}`,
      ].join("\n");
    } else {
      text = [
        `✗ Artifact verification FAILED: ${params.key}`,
        `Stored hash:  ${storedHash}`,
        `Computed hash: ${computedHash}`,
        "The artifact has been modified since sealing.",
      ].join("\n");
    }

    return {
      content: [{ type: "text", text }],
      details: {
        key: params.key,
        path: params.path,
        match,
        stored_hash: storedHash,
        computed_hash: computedHash,
      },
    };
  },
});

export default factory;

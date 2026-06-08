/**
 * SHA-256 artifact integrity utilities using Node crypto.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { HashResult } from "../state-machine/types.js";

const MAX_ARTIFACT_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Compute SHA-256 hex digest of file at `path`.
 * Returns null if the file does not exist.
 * Kept for backward compatibility — prefers using `computeHashWithContent`
 * for new callers to avoid TOCTOU (read-then-hash race).
 */
export function computeHash(path: string): string | null {
  const result = computeHashWithContent(path);
  if (result.status === "ok") return result.hash;
  return null;
}

/**
 * Read a file and compute its SHA-256 hash in a single operation.
 * Returns a discriminated result distinguishing "not found", "permission denied",
 * and generic errors — no silent conflation.
 *
 * Also validates: regular file only (no dirs, pipes, symlinks-to-dir),
 * and enforces a size limit (10 MB).
 */
export function computeHashWithContent(path: string): HashResult {
  const resolved = resolve(path);

  try {
    if (!existsSync(resolved)) {
      return { status: "not_found" };
    }
  } catch (err: unknown) {
    // existsSync can throw on permission-denied parent directories
    const msg = err instanceof Error ? err.message : String(err);
    if (isPermissionError(msg)) {
      return { status: "permission_denied", error: msg };
    }
    return { status: "error", error: msg };
  }

  try {
    const stat = statSync(resolved);

    if (!stat.isFile()) {
      return {
        status: "error",
        error: `Path is not a regular file: ${resolved}`,
      };
    }

    if (stat.size > MAX_ARTIFACT_SIZE) {
      return {
        status: "error",
        error: `File exceeds maximum artifact size (${MAX_ARTIFACT_SIZE} bytes): ${resolved}`,
      };
    }

    const data = readFileSync(resolved);
    const content = data.toString("utf-8");
    const hash = createHash("sha256").update(data).digest("hex");
    return { status: "ok", hash, content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isPermissionError(msg)) {
      return { status: "permission_denied", error: msg };
    }
    if (isNotFoundError(msg)) {
      return { status: "not_found" };
    }
    return { status: "error", error: msg };
  }
}

/**
 * Compute SHA-256 hex digest of raw string content.
 */
export function computeHashString(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Verify that a file's current hash matches a previously stored hash.
 */
export function verifyHash(path: string, storedHash: string): boolean {
  const current = computeHash(path);
  if (current === null) return false;
  return current === storedHash;
}

/**
 * Read file contents as string. Returns null if file does not exist.
 * Kept for backward compatibility — new callers should use `computeHashWithContent`
 * to get content+hash in one operation.
 */
export function readFile(path: string): string | null {
  const result = computeHashWithContent(path);
  if (result.status === "ok") return result.content;
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function isPermissionError(msg: string): boolean {
  return /\b(EACCES|EPERM|permission denied)\b/i.test(msg);
}

function isNotFoundError(msg: string): boolean {
  return /\b(ENOENT|no such file)\b/i.test(msg);
}

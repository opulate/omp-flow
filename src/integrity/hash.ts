/**
 * SHA-256 artifact integrity utilities using Node crypto.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Compute SHA-256 hex digest of file at `path`.
 * Returns null if the file does not exist.
 */
export function computeHash(path: string): string | null {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return null;
  }
  const data = readFileSync(resolved);
  return createHash("sha256").update(data).digest("hex");
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
 */
export function readFile(path: string): string | null {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return null;
  }
  return readFileSync(resolved, "utf-8");
}

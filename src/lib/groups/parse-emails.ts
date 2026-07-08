/**
 * Pure parsing for the admin "paste a list of emails" group-assignment path
 * (PLAN.md §13). Accepts a free-form blob (commas, semicolons, spaces, or
 * newlines), normalizes + de-dupes, and partitions into valid `@wisc.edu`
 * addresses vs. the rest. No I/O; the caller matches `valid` against the
 * roster and reports what didn't match.
 */
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";

export interface ParsedEmailList {
  /** Normalized, unique `@wisc.edu` addresses, in first-seen order. */
  valid: string[];
  /** Normalized, unique tokens that are not valid `@wisc.edu` addresses. */
  invalid: string[];
}

export function parseEmailList(blob: string): ParsedEmailList {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of blob.split(/[\s,;]+/)) {
    const token = normalizeEmail(raw);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    (isWiscEmail(token) ? valid : invalid).push(token);
  }

  return { valid, invalid };
}

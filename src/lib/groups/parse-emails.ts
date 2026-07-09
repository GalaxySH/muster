/**
 * Pure parsing for admin "paste a list of emails" inputs. Accepts a free-form
 * blob (commas, semicolons, spaces, or newlines), normalizes + de-dupes, and
 * partitions by the given validity check: the group-assignment path (PLAN.md
 * §13) keeps the default `@wisc.edu` gate, the digest-recipient list (roadmap
 * 3.1) passes `isEmailShaped` to accept any well-formed address. No I/O.
 */
import { normalizeEmail, isWiscEmail } from "@/lib/auth/policy";

export interface ParsedEmailList {
  /** Normalized, unique addresses that passed the check, in first-seen order. */
  valid: string[];
  /** Normalized, unique tokens that failed it. */
  invalid: string[];
}

export function parseEmailList(
  blob: string,
  isValid: (email: string) => boolean = isWiscEmail,
): ParsedEmailList {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of blob.split(/[\s,;]+/)) {
    const token = normalizeEmail(raw);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    (isValid(token) ? valid : invalid).push(token);
  }

  return { valid, invalid };
}

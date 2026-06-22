/**
 * Magic-link fallback auth — token primitives + pure validity logic (PLAN §11).
 *
 * The app generates and OWNS the token: a high-entropy random string, delivered
 * to the user's wisc.edu mailbox, with only its SHA-256 hash stored at rest. This
 * module is dependency-free (node crypto only — no env/DB) so the validity +
 * cooldown rules are unit-testable; the DB-backed issue/redeem lives in
 * ./magic-link-store (server-only).
 */
import { randomBytes, createHash } from "node:crypto";

/** Link lifetime (single-use, short — PLAN §11 "expires"). */
export const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;
/** Minimum gap between link requests for the same email (anti-spam). */
export const MAGIC_LINK_COOLDOWN_MS = 60 * 1000;

/** SHA-256 hex of the raw token — only this is persisted (never the raw token). */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** A fresh URL-safe token and its stored hash. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export type MagicLinkValidity = "ok" | "email_mismatch" | "revoked" | "redeemed" | "expired";

/** The fields of a `magic_links` row the validity check needs. */
export interface MagicLinkCheckRow {
  studentEmail: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Whether a found token row may be redeemed for `email` at `now`. Pure. Checks
 * the email binding first (the token is bound to one identity), then revoked /
 * already-redeemed / expired. Any non-`ok` result blocks redemption.
 */
export function magicLinkValidity(
  row: MagicLinkCheckRow,
  email: string,
  now: Date,
): MagicLinkValidity {
  if (row.studentEmail !== email) return "email_mismatch";
  if (row.revokedAt) return "revoked";
  if (row.redeemedAt) return "redeemed";
  if (now.getTime() >= row.expiresAt.getTime()) return "expired";
  return "ok";
}

/** ms until another request is allowed for an email; 0 = allowed now. */
export function cooldownRemainingMs(
  lastRequestedAt: Date | null,
  now: Date,
  cooldownMs: number = MAGIC_LINK_COOLDOWN_MS,
): number {
  if (!lastRequestedAt) return 0;
  return Math.max(0, cooldownMs - (now.getTime() - lastRequestedAt.getTime()));
}

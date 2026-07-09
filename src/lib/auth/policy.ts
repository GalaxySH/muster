/**
 * Pure authentication policy (PLAN.md §11).
 *
 * Kept free of framework/env imports so the sign-in rules are unit-testable.
 * The NextAuth callbacks (./config) and the magic-link path both call these.
 */

/** The only Google Workspace domain allowed to sign in. */
export const WISC_DOMAIN = "wisc.edu";

/** Trimmed, lowercased email for stable comparison/lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Domain part of an email (lowercased), or null if malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/** True for a `…@wisc.edu` address (the Google sign-in identity, PLAN §11). */
export function isWiscEmail(email: string): boolean {
  return emailDomain(email) === WISC_DOMAIN;
}

/**
 * True for any plausibly-deliverable address (local part + dotted domain).
 * Deliberately loose: a typo catch for admin-entered recipient lists, not an
 * identity check like isWiscEmail.
 */
export function isEmailShaped(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== null && domain.includes(".");
}

/** Shape of the Google profile fields relevant to the sign-in gate. */
export interface GoogleSignInClaims {
  email?: string | null;
  emailVerified?: boolean | null;
  /** Google Workspace hosted-domain claim, when present. */
  hd?: string | null;
}

/**
 * Domain-check gate for the student/admin Google path: a verified `@wisc.edu`
 * identity. Users this rejects (e.g. under-18 without a Google identity) are
 * routed to the magic-link fallback instead (PLAN §11).
 */
export function isAllowedGoogleSignIn(claims: GoogleSignInClaims): boolean {
  const email = claims.email?.trim();
  if (!email) return false;
  // email_verified is true for Workspace accounts; only reject an explicit false.
  if (claims.emailVerified === false) return false;
  // If Google sent an hd claim, it must be wisc.edu; the email domain is authoritative.
  if (claims.hd && claims.hd.toLowerCase() !== WISC_DOMAIN) return false;
  return isWiscEmail(email);
}

/** True if the (normalized) email is on the admin allowlist. */
export function isAdminEmail(email: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(normalizeEmail(email));
}

/**
 * Whether the dev-login bypass (a no-OAuth credentials path for local testing)
 * is active. Strictly gated: the env flag must be set AND it can NEVER be on in
 * production, regardless of the flag: defense in depth so it can't leak.
 */
export function isDevLoginEnabled(
  flag: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === "production") return false;
  return flag === "1" || flag === "true";
}

/**
 * Pure test-account email scheme. Test accounts live on a fixed synthetic,
 * non-deliverable domain, which is the security rail: it can never collide with
 * a roster email, never passes isWiscEmail (so the public magic-link request and
 * Google sign-in both reject it), and so the ONLY way to sign in as one is the
 * admin-minted token on /admin/test-users.
 */
import { emailDomain } from "@/lib/auth/policy";

export const TEST_ACCOUNT_DOMAIN = "test.muster.invalid";

const MAX_SLUG_LENGTH = 64;

/** Lowercase alnum+hyphen slug from a display name, or "" if nothing usable. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

/** Lowercase alnum with inner hyphens, ≤64 chars, no leading/trailing hyphen. */
export function isValidTestSlug(slug: string): boolean {
  if (slug.length > MAX_SLUG_LENGTH) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug);
}

/** The synthetic sign-in email for a (validated) slug. */
export function testEmailFromSlug(slug: string): string {
  return `${slug}@${TEST_ACCOUNT_DOMAIN}`;
}

/** True only for addresses on the synthetic domain: the impersonation rail. */
export function isTestAccountEmail(email: string): boolean {
  return emailDomain(email) === TEST_ACCOUNT_DOMAIN;
}

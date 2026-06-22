/**
 * DB-backed magic-link issue + redemption (PLAN §11). Server-only: wraps the pure
 * token primitives in ./magic-link with `magic_links` table access. Only the token
 * HASH is ever stored. Redemption is a single atomic UPDATE so a token can be
 * consumed exactly once even under a race.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { magicLinks } from "@/lib/db/schema";
import { normalizeEmail } from "./policy";
import {
  generateToken,
  hashToken,
  cooldownRemainingMs,
  MAGIC_LINK_TTL_MS,
} from "./magic-link";

/** Issue a token for an (already eligibility-checked) email; returns the raw token. */
export async function issueMagicLink(emailRaw: string): Promise<string> {
  const email = normalizeEmail(emailRaw);
  const { token, tokenHash } = generateToken();
  await getDb()
    .insert(magicLinks)
    .values({
      id: randomUUID(),
      studentEmail: email,
      tokenHash,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });
  return token;
}

/** ms remaining before another link may be issued for this email (0 = allowed). */
export async function requestCooldownMs(emailRaw: string, now: Date = new Date()): Promise<number> {
  const email = normalizeEmail(emailRaw);
  const [last] = await getDb()
    .select({ requestedAt: magicLinks.requestedAt })
    .from(magicLinks)
    .where(eq(magicLinks.studentEmail, email))
    .orderBy(desc(magicLinks.requestedAt))
    .limit(1);
  return cooldownRemainingMs(last?.requestedAt ?? null, now);
}

/**
 * Verify + atomically consume a token. Returns the bound email on success, null
 * otherwise. All validity rules (email binding, not revoked/redeemed/expired) are
 * pushed into the UPDATE's WHERE, so success ⇔ exactly one row was consumed.
 */
export async function redeemMagicLink(input: {
  token: string;
  email: string;
  ip?: string | null;
}): Promise<string | null> {
  if (!input.token) return null;
  const email = normalizeEmail(input.email);
  const now = new Date();
  const tokenHash = hashToken(input.token);

  const result = await getDb()
    .update(magicLinks)
    .set({ redeemedAt: now, redeemedFrom: input.ip ?? null })
    .where(
      and(
        eq(magicLinks.tokenHash, tokenHash),
        eq(magicLinks.studentEmail, email),
        isNull(magicLinks.redeemedAt),
        isNull(magicLinks.revokedAt),
        gt(magicLinks.expiresAt, now),
      ),
    );
  const affected = result[0].affectedRows;
  return affected > 0 ? email : null;
}

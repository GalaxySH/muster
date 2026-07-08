/**
 * Encrypted store for the admin Drive grant (PLAN.md §11, §12).
 *
 * Exactly the refresh token is persisted, AES-256-GCM encrypted, never in
 * plaintext, never in a cookie. The most recently connected admin is the active
 * grant the relay uses.
 */
import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminGoogleGrants } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secretbox";
import { encryptionKey } from "@/lib/env";

/** Encrypt + upsert the grant for an admin (keyed by their email). */
export async function saveDriveGrant(email: string, refreshToken: string): Promise<void> {
  const encrypted = encryptSecret(refreshToken, encryptionKey);
  const db = getDb();
  await db
    .insert(adminGoogleGrants)
    .values({ email, refreshTokenEncrypted: encrypted })
    .onDuplicateKeyUpdate({ set: { refreshTokenEncrypted: encrypted } });
}

export interface DriveGrant {
  email: string;
  refreshToken: string;
}

/** The active grant (most recently updated), decrypted, or null if none. */
export async function getActiveDriveGrant(): Promise<DriveGrant | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(adminGoogleGrants)
    .orderBy(desc(adminGoogleGrants.updatedAt))
    .limit(1);
  if (!row) return null;
  return { email: row.email, refreshToken: decryptSecret(row.refreshTokenEncrypted, encryptionKey) };
}

export interface DriveGrantStatus {
  connected: boolean;
  email?: string;
  updatedAt?: Date;
}

/** Connection status for the admin UI (no secret material). */
export async function getDriveGrantStatus(): Promise<DriveGrantStatus> {
  const db = getDb();
  const [row] = await db
    .select({ email: adminGoogleGrants.email, updatedAt: adminGoogleGrants.updatedAt })
    .from(adminGoogleGrants)
    .orderBy(desc(adminGoogleGrants.updatedAt))
    .limit(1);
  return row ? { connected: true, email: row.email, updatedAt: row.updatedAt } : { connected: false };
}

/** Remove an admin's grant (disconnect). */
export async function deleteDriveGrant(email: string): Promise<void> {
  const db = getDb();
  await db.delete(adminGoogleGrants).where(eq(adminGoogleGrants.email, email));
}

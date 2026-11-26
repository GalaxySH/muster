/**
 * Where an admin's console preferences live: one `app_settings` row per admin,
 * keyed by a hash of their email (the key column holds 64 characters, an email
 * up to 255). The value is the JSON of `AdminPrefs`.
 */
import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { getSetting, setSetting } from "@/lib/settings";
import { normalizeEmail } from "@/lib/auth/policy";
import { parseAdminPrefs, type AdminPrefs } from "./preferences-shape";

export function adminPrefsKey(email: string): string {
  const hash = createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 40);
  return `admin_prefs:${hash}`;
}

export async function getAdminPrefs(email: string): Promise<AdminPrefs> {
  return parseAdminPrefs(await getSetting(adminPrefsKey(email)));
}

/** The same read, done once per request however many server components ask (the shell and a page). */
export const getAdminPrefsCached = cache(getAdminPrefs);

/** Merges `patch` into what is stored. */
export async function saveAdminPrefs(
  email: string,
  patch: Partial<AdminPrefs>,
): Promise<AdminPrefs> {
  const next = { ...(await getAdminPrefs(email)), ...patch };
  await setSetting(adminPrefsKey(email), JSON.stringify(next));
  return next;
}

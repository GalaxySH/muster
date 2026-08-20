/**
 * Server-only database handle (Drizzle + mysql2 pool).
 *
 * The pool is created lazily on first use so importing types/schema never
 * opens a socket. CLI scripts should use ./client (createDb) instead.
 *
 * Cached on globalThis, not a module-level variable: dev-mode HMR discards
 * and re-evaluates this module on edits, and a module-level cache leaks one
 * pool per reload until MariaDB refuses connections (hit live at the default
 * 151-connection cap). globalThis survives re-evaluation; a production build
 * evaluates once either way, so this is the same singleton there. The cache
 * also outlives a DATABASE_URL edit: a dev who repoints .env keeps talking to
 * the old database until the server restarts.
 */
import "server-only";
import { env } from "@/lib/env";
import { createDb, type Database } from "./client";

const globalHandle = globalThis as { musterDb?: Database };

export function getDb(): Database {
  return (globalHandle.musterDb ??= createDb(env.DATABASE_URL).db);
}

export * as schema from "./schema";

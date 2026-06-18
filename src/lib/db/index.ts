/**
 * Server-only database handle (Drizzle + mysql2 pool).
 *
 * The pool is created lazily on first use so importing types/schema never
 * opens a socket. CLI scripts should use ./client (createDb) instead.
 */
import "server-only";
import { env } from "@/lib/env";
import { createDb, type Database } from "./client";

let database: Database | undefined;

export function getDb(): Database {
  if (!database) {
    database = createDb(env.DATABASE_URL).db;
  }
  return database;
}

export * as schema from "./schema";

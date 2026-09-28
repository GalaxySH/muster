/**
 * Drizzle connection factory. Plain module (no `server-only`) so CLI scripts
 * (seed, migrate) can reuse it; the app uses the guarded ./index wrapper.
 */
import { existsSync } from "node:fs";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type Database = MySql2Database<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: mysql.Pool;
}

/**
 * DATABASE_URL for CLI scripts, which run outside Next and so don't get its env
 * loading. Picks up .env.local like `next dev` does (drizzle.config.ts does the
 * same); vars already in the environment win.
 */
export function cliDatabaseUrl(): string {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (see .env.example)");
  return url;
}

export function createDb(url: string): DbHandle {
  const pool = mysql.createPool(url);
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool };
}

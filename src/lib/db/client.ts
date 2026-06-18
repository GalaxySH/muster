/**
 * Drizzle connection factory. Plain module (no `server-only`) so CLI scripts
 * (seed, migrate) can reuse it; the app uses the guarded ./index wrapper.
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type Database = MySql2Database<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: mysql.Pool;
}

export function createDb(url: string): DbHandle {
  const pool = mysql.createPool(url);
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool };
}

/**
 * Liveness/readiness probe for deploys and uptime monitoring (PLAN §15).
 *
 * 200 { ok: true } when the app can reach the database, 503 otherwise.
 * Unauthenticated by design: it reveals nothing beyond up/down, and the
 * deploy workflow + any external monitor need to reach it without a session.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

// Never prerendered/cached: every probe must exercise the live DB connection.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Health check failed:", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}

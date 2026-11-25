/**
 * Liveness/readiness probe for deploys and uptime monitoring (PLAN §15).
 *
 * 200 { ok: true } when the app can reach the database and read the current
 * term, 503 otherwise. Without a current term every page fails, so a deploy
 * must not pass on a bare DB connection. Unauthenticated by design: it reveals
 * nothing beyond up/down, and the deploy workflow + any external monitor need
 * to reach it without a session.
 */
import { getDb } from "@/lib/db";
import { getCurrentTermId } from "@/lib/terms/term-id";

// Never prerendered/cached: every probe must exercise the live DB connection.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // A query like any other, so it also proves the DB is reachable. Throws
    // when the current-term pointer is missing or names no term.
    await getCurrentTermId(getDb());
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Health check failed:", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}

/**
 * Manual fallback trigger for the schedule-change digest (roadmap 3.1). The
 * daily run is the in-app scheduler (lib/changes/scheduler.ts); this route
 * lets ops force a run by hand: curl with `Authorization: Bearer
 * $CRON_SECRET`. It calls runChangeDigest directly, skipping the scheduler's
 * due-check and claim, because a manual run must fire even when one is not
 * owed. With CRON_SECRET unset the route refuses everything.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runChangeDigest } from "@/lib/changes/digest";

export const dynamic = "force-dynamic";

// Constant-time bearer comparison; hashing first equalizes lengths.
function isAuthorized(header: string | null): boolean {
  if (!env.CRON_SECRET || !header?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(env.CRON_SECRET).digest();
  return timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  if (!env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runChangeDigest();
    return Response.json(result);
  } catch (e) {
    console.error("Change digest run failed:", e);
    return Response.json({ error: "digest run failed" }, { status: 500 });
  }
}

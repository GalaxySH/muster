/**
 * Cron trigger for the daily schedule-change digest (roadmap 3.1). The host's
 * cron curls this once a day with `Authorization: Bearer $CRON_SECRET`
 * (docs/deploy.md); there is no in-process scheduler. With CRON_SECRET unset
 * the route refuses everything, so the endpoint is inert until ops opts in.
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

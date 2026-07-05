/**
 * Start the admin Drive grant flow (PLAN.md §12). Admin-only; sets a one-time
 * state cookie and redirects to Google consent for `drive.file`.
 *
 * Absolute redirects must use the canonical public base (env.NEXTAUTH_URL),
 * NOT req.url: behind the reverse proxy the standalone server reports its own
 * listen address (localhost:3000), which would bounce the browser off-site.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getAppSession } from "@/lib/auth/session";
import { getDriveAuthUrl, DRIVE_STATE_COOKIE } from "@/lib/drive/oauth";
import { env } from "@/lib/env";

export async function GET() {
  const session = await getAppSession();
  if (!session) {
    return NextResponse.redirect(new URL("/signin?callbackUrl=/admin/drive", env.NEXTAUTH_URL));
  }
  if (!session.isAdmin) {
    return NextResponse.redirect(new URL("/me", env.NEXTAUTH_URL));
  }

  const state = randomUUID();
  const jar = await cookies();
  jar.set(DRIVE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NEXTAUTH_URL.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });

  return NextResponse.redirect(getDriveAuthUrl(state));
}

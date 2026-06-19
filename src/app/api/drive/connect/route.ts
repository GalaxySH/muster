/**
 * Start the admin Drive grant flow (PLAN.md §12). Admin-only; sets a one-time
 * state cookie and redirects to Google consent for `drive.file`.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getAppSession } from "@/lib/auth/session";
import { getDriveAuthUrl, DRIVE_STATE_COOKIE } from "@/lib/drive/oauth";

export async function GET(req: Request) {
  const session = await getAppSession();
  if (!session) {
    return NextResponse.redirect(new URL("/signin?callbackUrl=/admin/drive", req.url));
  }
  if (!session.isAdmin) {
    return NextResponse.redirect(new URL("/me", req.url));
  }

  const state = randomUUID();
  const jar = await cookies();
  jar.set(DRIVE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });

  return NextResponse.redirect(getDriveAuthUrl(state));
}

/**
 * Drive grant callback (PLAN.md §12). Verifies the state cookie, exchanges the
 * code for a refresh token, and stores it encrypted. Admin-only.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppSession } from "@/lib/auth/session";
import { exchangeCodeForGrant, DRIVE_STATE_COOKIE } from "@/lib/drive/oauth";
import { saveDriveGrant } from "@/lib/drive/grants";

function back(req: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/admin/drive", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.redirect(new URL("/signin?callbackUrl=/admin/drive", req.url));
  if (!session.isAdmin) return NextResponse.redirect(new URL("/me", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get(DRIVE_STATE_COOKIE)?.value;
  jar.delete(DRIVE_STATE_COOKIE);

  if (oauthError) return back(req, { error: oauthError });
  if (!code || !state || !expected || state !== expected) {
    return back(req, { error: "state" });
  }

  try {
    const grant = await exchangeCodeForGrant(code);
    await saveDriveGrant(grant.email, grant.refreshToken);
    return back(req, { connected: "1" });
  } catch (e) {
    console.error("Drive grant exchange failed:", e);
    return back(req, { error: "exchange" });
  }
}

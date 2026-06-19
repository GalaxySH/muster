/**
 * Admin-only Google OAuth flow for the `drive.file` grant (PLAN.md §11, §12).
 *
 * This is deliberately separate from student sign-in (which uses sign-in scopes
 * only and JWT sessions). Here we request offline access so Google returns a
 * durable refresh token, which we store encrypted (never in a cookie). Scope is
 * `drive.file` only — the app can touch the files it creates, nothing else.
 */
import "server-only";
import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";
import { WISC_DOMAIN } from "@/lib/auth/policy";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GRANT_SCOPES = ["openid", "email", DRIVE_FILE_SCOPE];

/** One-time CSRF state cookie name for the grant flow. */
export const DRIVE_STATE_COOKIE = "drive_oauth_state";

/** Redirect URI Google must have on the OAuth client (register this exact URL). */
export function driveRedirectUri(): string {
  return `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/drive/callback`;
}

function oauthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: driveRedirectUri(),
  });
}

/** Consent URL for the admin to grant `drive.file` (forces a fresh refresh token). */
export function getDriveAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensure Google returns a refresh_token every time
    scope: GRANT_SCOPES,
    // Deliberately NOT include_granted_scopes: this is a dedicated least-privilege
    // grant. Merging prior grants would resurface the full `drive` scope this
    // account granted during the Phase 0 spike (PLAN §11) — exactly drive.file only.
    include_granted_scopes: false,
    state,
    hd: WISC_DOMAIN,
  });
}

export interface ExchangedGrant {
  /** The granting account's email (from the id_token). */
  email: string;
  refreshToken: string;
}

/** Exchange the OAuth `code` for a refresh token + the granting account email. */
export async function exchangeCodeForGrant(code: string): Promise<ExchangedGrant> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app's access and re-connect so consent is shown again.",
    );
  }
  if (!tokens.id_token) throw new Error("No id_token returned from Google.");

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const email = ticket.getPayload()?.email;
  if (!email) throw new Error("No email present in the Google id_token.");

  return { email, refreshToken: tokens.refresh_token };
}

/** Mint a short-lived access token from a stored refresh token. */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain an access token from the refresh token.");
  return token;
}

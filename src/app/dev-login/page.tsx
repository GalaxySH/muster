import { redirect } from "next/navigation";
import { devLoginEnabled } from "@/lib/env";
import { devSignInAction } from "@/lib/auth/actions";
import { Page } from "@/components/ui";

// Env-gated redirect; never statically prerender.
export const dynamic = "force-dynamic";

/**
 * DEV ONLY sign-in bypass (no OAuth). The route redirects to /signin unless the
 * env-gated bypass is active; it can never render in prod. Throwaway test
 * accounts are managed on /admin/test-users (sign in as an admin first).
 */
export default function DevLoginPage() {
  if (!devLoginEnabled) redirect("/signin");

  return (
    <Page>
      <h1>Dev login</h1>
      <p style={banner}>
        <strong>Local testing only.</strong> This bypasses Google OAuth and is disabled in
        production. Enter any <code>@wisc.edu</code> email to sign in as that identity.
      </p>
      <form action={devSignInAction} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input type="email" name="email" defaultValue="stu@wisc.edu" required style={{ flex: 1, padding: 8 }} />
        <button type="submit">Sign in</button>
      </form>
      <p style={{ color: "#555", fontSize: 14, marginTop: "1.2rem" }}>
        Test accounts are managed at <code>/admin/test-users</code> (sign in as an admin
        first).
      </p>
    </Page>
  );
}

const banner: React.CSSProperties = {
  background: "#fff4d6",
  border: "1px solid #e0c060",
  borderRadius: 6,
  padding: "0.6rem 0.9rem",
  fontSize: 14,
};

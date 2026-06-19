import { redirect } from "next/navigation";
import { devLoginEnabled } from "@/lib/env";
import { devSignInAction } from "@/lib/auth/actions";

/**
 * DEV ONLY sign-in bypass (no OAuth). The route 404-equivalents (redirects to
 * /signin) unless the env-gated bypass is active — it can never render in prod.
 */
export default function DevLoginPage() {
  if (!devLoginEnabled) redirect("/signin");

  return (
    <main style={{ padding: "2rem", maxWidth: 480 }}>
      <h1>Dev login</h1>
      <p
        style={{
          background: "#fff4d6",
          border: "1px solid #e0c060",
          borderRadius: 6,
          padding: "0.6rem 0.9rem",
          fontSize: 14,
        }}
      >
        <strong>Local testing only.</strong> This bypasses Google OAuth and is disabled in
        production. Enter any <code>@wisc.edu</code> email to sign in as that identity.
      </p>
      <form action={devSignInAction} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="email"
          name="email"
          defaultValue="stu@wisc.edu"
          required
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}

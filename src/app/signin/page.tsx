import Link from "next/link";
import { signIn } from "@/lib/auth";
import { getAppSession } from "@/lib/auth/session";
import { devLoginEnabled } from "@/lib/env";
import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/auth/magic-link-actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; sent?: string }>;
}) {
  const session = await getAppSession();
  if (session) redirect("/me");

  const { error, callbackUrl, sent } = await searchParams;

  return (
    <main style={{ padding: "2rem", maxWidth: 480 }}>
      <h1>Sign in to Muster</h1>
      {error && (
        <p style={{ color: "var(--color-text-danger, #b00)" }}>
          That account can&apos;t sign in here. Use your <strong>@wisc.edu</strong> Google account,
          or request an email sign-in link below.
        </p>
      )}
      {sent && (
        <p
          role="status"
          style={{
            background: "#e6f4ea",
            border: "1px solid #b7dfc2",
            borderRadius: 6,
            padding: "0.6rem 0.9rem",
            fontSize: 14,
          }}
        >
          If that address is eligible, we&apos;ve sent a sign-in link. Check your{" "}
          <strong>@wisc.edu</strong> email — the link expires in 30 minutes.
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl || "/me" });
        }}
      >
        <button type="submit">Sign in with wisc.edu</button>
      </form>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>
          Didn&apos;t work? Email me a sign-in link
        </summary>
        <p style={{ fontSize: 13, color: "#555", margin: "8px 0" }}>
          For under-18 or non-Google <code>@wisc.edu</code> users. We&apos;ll email a one-time link
          to your wisc.edu address.
        </p>
        <form action={requestMagicLink} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
          <input type="text" name="name" placeholder="Your name (optional)" style={field} />
          <input type="email" name="email" placeholder="you@wisc.edu" required style={field} />
          <button type="submit">Send sign-in link</button>
        </form>
      </details>

      {devLoginEnabled && (
        <p style={{ marginTop: 16, fontSize: 13 }}>
          <Link href="/dev-login">Dev login (local testing)</Link>
        </p>
      )}
    </main>
  );
}

const field: React.CSSProperties = {
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
};

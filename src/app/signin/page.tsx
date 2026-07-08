import Link from "next/link";
import { signIn } from "@/lib/auth";
import { getAppSession } from "@/lib/auth/session";
import { devLoginEnabled } from "@/lib/env";
import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/auth/magic-link-actions";
import { InfoCard, Page } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; sent?: string }>;
}) {
  const session = await getAppSession();
  if (session) redirect("/me");

  const { error, callbackUrl, sent } = await searchParams;

  return (
    <Page width="narrow">
      <h1>Sign in to Muster</h1>
      {error && (
        <InfoCard tone="danger" role="status">
          <p style={{ margin: 0 }}>
            That account can&apos;t sign in here. Use your <strong>@wisc.edu</strong> Google
            account, or request an email sign-in link below.
          </p>
        </InfoCard>
      )}
      {sent && (
        <InfoCard tone="success" role="status">
          <p style={{ margin: 0 }}>
            If that address is eligible, we&apos;ve sent a sign-in link. Check your{" "}
            <strong>@wisc.edu</strong> email — the link expires in 30 minutes.
          </p>
        </InfoCard>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl || "/me" });
        }}
      >
        <SubmitButton pendingLabel="Signing you in…">Sign in with wisc.edu</SubmitButton>
      </form>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>
          Didn&apos;t work? Email me a sign-in link
        </summary>
        <p style={{ fontSize: 13, color: "#555", margin: "8px 0" }}>
          If we recognize you, we&apos;ll email a one-time link
          to your wisc.edu address.
        </p>
        <form action={requestMagicLink} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
          <input type="email" name="email" placeholder="you@wisc.edu" required style={field} />
          <SubmitButton
            variant="secondary"
            pendingLabel="Sending…"
            style={{ justifySelf: "start" }}
          >
            Send sign-in link
          </SubmitButton>
        </form>
      </details>

      {devLoginEnabled && (
        <p style={{ marginTop: 16, fontSize: 13 }}>
          <Link href="/dev-login">Dev login (local testing)</Link>
        </p>
      )}
    </Page>
  );
}

const field: React.CSSProperties = {
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: 14,
};

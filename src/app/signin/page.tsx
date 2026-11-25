import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/lib/auth";
import { getAppSession } from "@/lib/auth/session";
import { devLoginEnabled } from "@/lib/env";
import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/auth/magic-link-actions";
import { StudentPage } from "@/components/student/StudentPage";
import { Card, Notice } from "@/components/student/ui";
import { FormSubmitButton } from "@/components/student/FormControls";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; sent?: string }>;
}) {
  const session = await getAppSession();
  if (session) redirect("/me");

  const { error, callbackUrl, sent } = await searchParams;

  return (
    <StudentPage width="narrow" home="none">
      {error && (
        <Notice tone="danger" role="alert">
          <p>
            That account can&apos;t sign in here. Use your <strong>@wisc.edu</strong> Google
            account, or request an email sign-in link below.
          </p>
        </Notice>
      )}
      {sent && (
        <Notice tone="success" role="status">
          <p>
            If that address is eligible, we&apos;ve sent a sign-in link. Check your{" "}
            <strong>@wisc.edu</strong> email. The link expires in 1 day.
          </p>
        </Notice>
      )}
      <Card>
        <h1>Sign in to Muster</h1>
        <p className="sf-muted">Use your UW-Madison Google account.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl || "/me" });
          }}
        >
          <FormSubmitButton block pendingLabel="Signing you in…">
            Sign in with wisc.edu
          </FormSubmitButton>
        </form>

        <details className="sf-disclosure">
          <summary>Didn&apos;t work? Email me a sign-in link</summary>
          <form action={requestMagicLink} className="sf-stack">
            <div className="sf-field">
              <label htmlFor="magic-email" className="sf-label">
                Your wisc.edu email
              </label>
              <input
                id="magic-email"
                type="email"
                name="email"
                placeholder="you@wisc.edu"
                autoComplete="email"
                required
                className="sf-input"
                aria-describedby="magic-email-hint"
              />
              <p id="magic-email-hint" className="sf-hint">
                If we recognize you, we&apos;ll email a one-time link to your wisc.edu address.
              </p>
            </div>
            <FormSubmitButton variant="secondary" block pendingLabel="Sending…">
              Send sign-in link
            </FormSubmitButton>
          </form>
        </details>
      </Card>

      {devLoginEnabled && (
        <p className="sf-small">
          <Link href="/dev-login" className="sf-inline-link">
            Dev login (local testing)
          </Link>
        </p>
      )}
    </StudentPage>
  );
}
